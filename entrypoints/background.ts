import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { REPOSITORY_PATTERN } from '@/lib/constants';
import { runtimeMessageSchema } from '@/lib/schemas/messages';
import { setBadge } from '@/lib/api/badge';
import { uploadSolution } from '@/lib/api/github';
import {
  activeUpload,
  branchName,
  dailyQuestionData,
  githubToken,
  lastSyncStatus,
  migrateLegacyToken,
  pendingSubmissions,
  recentSolutions,
  recentSubmissionKeys,
  repoName,
} from '@/lib/api/storage';
import type { RuntimeMessage } from '@/lib/types/messages';
import type { QueuedSubmission, Submission } from '@/lib/types/submission';
import { errorMessage, isLeetCodeUrl } from '@/lib/utils/helpers';

const RETRY_ALARM = 'retry-pending-submissions';
const DAILY_QUESTION_ALARM = 'fetch-daily-question';
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const MAX_RECENT_KEYS = 1000;
const MAX_RECENT_SOLUTIONS = 5;
// Notification IDs carry the GitHub URL of a saved solution, so a click can open it after a worker restart.
const OPEN_URL_PREFIX = 'open-url:';
// Chrome rejects notification IDs longer than this.
const MAX_NOTIFICATION_ID_LENGTH = 500;

let processing = false;
// Set when processQueue is called mid-run, e.g. by Retry now, so newly due items are not left for the alarm.
let rerunQueue = false;
let queueLock: Promise<unknown> = Promise.resolve();
let lastDailyFetchDay = -1;

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const message = runtimeMessageSchema.safeParse(raw);
    if (!message.success) return false;

    handleMessage(message.data, sender)
      .catch((error: unknown) => console.error('LeetWithGit could not handle a message:', error))
      .finally(() => sendResponse());
    return true;
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RETRY_ALARM) void processQueue();
    if (alarm.name === DAILY_QUESTION_ALARM) void fetchAndCacheDailyQuestion();
  });

  browser.notifications.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith(OPEN_URL_PREFIX)) return;
    void browser.notifications.clear(notificationId);
    void browser.tabs.create({ url: notificationId.slice(OPEN_URL_PREFIX.length) });
  });

  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    await migrateLegacyToken();
    await injectIntoOpenLeetCodeTabs(reason === 'install');
    await processQueue();
    await fetchAndCacheDailyQuestion();
  });

  browser.runtime.onStartup.addListener(() => {
    void processQueue();
    void fetchAndCacheDailyQuestion();
  });

  // Set initial badge state and watch for changes
  updateBadgeFromStorage().catch(() => {});
  dailyQuestionData.watch(updateBadgeFromStorage);
});

async function updateBadgeFromStorage(): Promise<void> {
  try {
    const data = await dailyQuestionData.getValue();
    if (data && !data.isCompleted) {
      await setBadge('daily-incomplete').catch(() => {});
    } else {
      await setBadge('clear').catch(() => {});
    }
  } catch (error: unknown) {
    console.error('[LeetWithGit] Failed to update badge:', error);
  }
}

// LeetCode tabs opened before an install or update keep running without our scripts, or with a relay
// the update cut off, so their accepted solutions would not be saved until the page is refreshed.
async function injectIntoOpenLeetCodeTabs(firstInstall: boolean): Promise<void> {
  const tabs = await browser.tabs.query({ url: 'https://leetcode.com/*' });
  await Promise.allSettled(
    tabs.map(async ({ id: tabId }) => {
      if (tabId === undefined) return;
      await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/leetcode.js'] });
      // The capture hook survives updates; refresh the profile after reconnecting the relay.
      await browser.scripting.executeScript({
        target: { tabId },
        files: firstInstall
          ? ['/content-scripts/capture.js', '/content-scripts/profile.js']
          : ['/content-scripts/profile.js'],
        world: 'MAIN',
      });
    }),
  );
}

function handleMessage(message: RuntimeMessage, sender: Browser.runtime.MessageSender): Promise<void> {
  switch (message.type) {
    case 'queue-submission':
      return queueFromLeetCode(message.payload, sender);
    case 'retry-now':
      return retryNow();
    case 'process-queue':
      return processQueue();
  }
}

async function queueFromLeetCode(
  payload: Submission,
  sender: Browser.runtime.MessageSender,
): Promise<void> {
  if (!sender.tab || !isLeetCodeUrl(sender.url)) throw new Error('Submission did not come from LeetCode.');
  if (await enqueue(payload)) await processQueue();

  // Update daily question completion if this submission matches today's daily question
  await updateDailyQuestionCompletion(payload);
}

async function updateDailyQuestionCompletion(payload: Submission): Promise<void> {
  try {
    const data = await dailyQuestionData.getValue();
    if (!data) return;

    // Extract slug from payload URL (e.g., "two-sum" from "https://leetcode.com/problems/two-sum/")
    const payloadSlug = payload.problemTitle?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const dataSlug = data.url.match(/\/problems\/([^/]+)/)?.[1];

    if (payloadSlug && dataSlug && payloadSlug === dataSlug) {
      console.log('[LeetWithGit] Marking daily question as completed:', dataSlug);
      await dailyQuestionData.setValue({ ...data, isCompleted: true });
    } else {
      console.log('[LeetWithGit] Submission does not match daily question, refreshing status from server');
      await fetchAndCacheDailyQuestion();
    }
  } catch (error: unknown) {
    console.error('[LeetWithGit] Could not update daily question completion:', error);
  }
}

function withQueueLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queueLock.then(task, task);
  queueLock = run.catch(() => {});
  return run;
}

async function enqueue(payload: Submission): Promise<boolean> {
  const submissionKey = await submissionKeyFor(payload);
  return withQueueLock(async () => {
    const [queue, recent] = await Promise.all([pendingSubmissions.getValue(), recentSubmissionKeys.getValue()]);
    if (recent.includes(submissionKey) || queue.some((item) => item.submissionKey === submissionKey)) return false;

    await pendingSubmissions.setValue([...queue, { payload, submissionKey, attempts: 0, nextAttemptAt: Date.now() }]);
    return true;
  });
}

async function submissionKeyFor(payload: Submission): Promise<string> {
  if (payload.submissionId) return `leetcode:${payload.submissionId}`;
  const input = new TextEncoder().encode(`${payload.questionId}\n${payload.language}\n${payload.code}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function retryNow(): Promise<void> {
  await withQueueLock(async () => {
    const queue = await pendingSubmissions.getValue();
    await pendingSubmissions.setValue(queue.map((item) => ({ ...item, nextAttemptAt: Date.now() })));
  });
  await processQueue();
}

async function processQueue(): Promise<void> {
  if (processing) {
    rerunQueue = true;
    return;
  }
  processing = true;
  rerunQueue = false;
  let attempted = 0;
  let saved = 0;
  try {
    const now = Date.now();
    const due = (await pendingSubmissions.getValue()).filter((item) => item.nextAttemptAt <= now);
    attempted = due.length;
    for (const item of due) {
      const { problemTitle, difficulty, language } = item.payload;
      await activeUpload.setValue({ problemTitle, difficulty, language, startedAt: Date.now() });
      await setBadge('uploading').catch(() => {});
      try {
        await markUploaded(item, await upload(item.payload));
        saved += 1;
      } catch (error: unknown) {
        await markFailed(item, error);
      }
    }
  } finally {
    processing = false;
    await activeUpload.setValue(null);
    const waiting = (await pendingSubmissions.getValue()).length;
    if (attempted || waiting) {
      await setBadge(waiting ? 'waiting' : saved ? 'saved' : 'clear', waiting).catch(() => {});
    }
    await scheduleRetry().catch((error: unknown) => {
      console.error('LeetWithGit could not schedule queued uploads:', error);
    });
  }
  if (rerunQueue) await processQueue();
}

async function markUploaded(item: QueuedSubmission, fileUrl: string): Promise<void> {
  const { problemTitle, difficulty, language } = item.payload;
  const message = `Saved ${problemTitle} to GitHub.`;
  await withQueueLock(async () => {
    const [queue, recent, solutions] = await Promise.all([
      pendingSubmissions.getValue(),
      recentSubmissionKeys.getValue(),
      recentSolutions.getValue(),
    ]);
    const saved = { problemTitle, difficulty, language, fileUrl, savedAt: Date.now() };
    await Promise.all([
      pendingSubmissions.setValue(queue.filter((queued) => queued.submissionKey !== item.submissionKey)),
      recentSubmissionKeys.setValue([...recent, item.submissionKey].slice(-MAX_RECENT_KEYS)),
      recentSolutions.setValue([saved, ...solutions].slice(0, MAX_RECENT_SOLUTIONS)),
      lastSyncStatus.setValue({ status: 'success', message, updatedAt: Date.now() }),
    ]);
  });
  notify('LeetWithGit', message, fileUrl);
}

async function markFailed(item: QueuedSubmission, error: unknown): Promise<void> {
  const attempts = await withQueueLock(async () => {
    const queue = await pendingSubmissions.getValue();
    const current = queue.find((queued) => queued.submissionKey === item.submissionKey);
    if (!current) return null;

    current.attempts += 1;
    current.nextAttemptAt = Date.now() + Math.min(30_000 * 2 ** Math.min(current.attempts - 1, 7), MAX_RETRY_DELAY_MS);
    await Promise.all([
      pendingSubmissions.setValue(queue),
      lastSyncStatus.setValue({
        status: 'retrying',
        message: errorMessage(error),
        updatedAt: Date.now(),
      }),
    ]);
    return current.attempts;
  });
  if (attempts === 1) notify('LeetWithGit: upload queued', 'A submission will retry when GitHub is reachable.');
}

async function scheduleRetry(): Promise<void> {
  const queue = await pendingSubmissions.getValue();
  if (!queue.length) {
    await browser.alarms.clear(RETRY_ALARM);
    return;
  }
  const nextAttemptAt = Math.min(...queue.map((item) => item.nextAttemptAt));
  await browser.alarms.create(RETRY_ALARM, { when: Math.max(Date.now() + 1000, nextAttemptAt) });
}

async function fetchAndCacheDailyQuestion(): Promise<void> {
  const now = new Date();
  const utcDay = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));

  if (lastDailyFetchDay === utcDay) {
    console.log('[LeetWithGit] Daily question already fetched today');
    return;
  }

  console.log('[LeetWithGit] Fetching daily question for UTC day:', utcDay);
  lastDailyFetchDay = utcDay;

  try {
    const data = await fetchDailyQuestionData();
    await dailyQuestionData.setValue(data);
    console.log('[LeetWithGit] Daily question cached:', data);

    // Update badge after caching
    if (data && !data.isCompleted) {
      await setBadge('daily-incomplete').catch(() => {});
    } else {
      await setBadge('clear').catch(() => {});
    }
  } catch (error: unknown) {
    console.error('[LeetWithGit] Failed to fetch daily question:', error);
    await dailyQuestionData.setValue(null);
    await setBadge('clear').catch(() => {});
  }

  // Schedule next fetch for tomorrow at midnight UTC
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  await browser.alarms.create(DAILY_QUESTION_ALARM, { when: tomorrow.getTime() });
}

async function fetchDailyQuestionData(): Promise<{ url: string; streak: number; isCompleted: boolean; title?: string; difficulty?: string; questionNumber?: string }> {
  const DAILY_QUESTION_FALLBACK = 'https://leetcode.com/problemset/';

  const response = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: '{ activeDailyCodingChallengeQuestion { question { titleSlug title difficulty questionFrontendId } userStatus } }',
    }),
    credentials: 'include',
  });

  if (!response.ok) throw new Error(`Daily question lookup failed (${response.status}).`);

  const result = (await response.json()) as {
    data?: {
      activeDailyCodingChallengeQuestion?: {
        question?: { titleSlug?: string; title?: string; difficulty?: string; questionFrontendId?: string } | null;
        userStatus?: string | null;
      } | null;
    };
    errors?: { message: string }[];
  };

  if (result.errors?.length || !result.data) throw new Error(result.errors?.[0]?.message ?? 'Daily question lookup failed.');

  const slug = result.data.activeDailyCodingChallengeQuestion?.question?.titleSlug;
  const title = result.data.activeDailyCodingChallengeQuestion?.question?.title;
  const difficulty = result.data.activeDailyCodingChallengeQuestion?.question?.difficulty;
  const questionNumber = result.data.activeDailyCodingChallengeQuestion?.question?.questionFrontendId;
  const completionStatus = result.data.activeDailyCodingChallengeQuestion?.userStatus;
  const isCompleted = completionStatus === 'ac' || completionStatus === 'AC';

  const url = typeof slug === 'string' && /^[a-z0-9-]+$/i.test(slug)
    ? `https://leetcode.com/problems/${encodeURIComponent(slug)}/description/`
    : DAILY_QUESTION_FALLBACK;

  let streak = 0;
  if (slug) {
    streak = await fetchDailyStreakFromPanel(slug).catch((err) => {
      console.error('[LeetWithGit] Failed to fetch streak:', err);
      return 0;
    });
  }

  return { url, streak, isCompleted, title, difficulty, questionNumber };
}

async function fetchDailyStreakFromPanel(currentQuestionSlug: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const response = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query panelQuestionList($currentQuestionSlug: String!, $envId: String, $envType: String) {
        panelQuestionList(
          currentQuestionSlug: $currentQuestionSlug
          envId: $envId
          envType: $envType
        ) {
          finishedLength
        }
      }`,
      variables: {
        currentQuestionSlug,
        envId: today,
        envType: 'daily-question',
      },
    }),
    credentials: 'include',
  });

  if (!response.ok) throw new Error(`Streak lookup failed (${response.status}).`);

  const result = (await response.json()) as {
    data?: {
      panelQuestionList?: { finishedLength?: number } | null;
    };
    errors?: { message: string }[];
  };

  if (result.errors?.length) throw new Error(result.errors[0]?.message ?? 'Streak lookup failed.');

  const finishedLength = result.data?.panelQuestionList?.finishedLength ?? 0;
  return finishedLength;
}

function notify(title: string, message: string, openUrl?: string): void {
  const openId = openUrl && `${OPEN_URL_PREFIX}${openUrl}`;
  const id = openId && openId.length <= MAX_NOTIFICATION_ID_LENGTH ? openId : crypto.randomUUID();
  void browser.notifications.create(id, {
    type: 'basic',
    iconUrl: browser.runtime.getURL('/icon/128.png'),
    title,
    message,
  });
}

async function upload(payload: Submission): Promise<string> {
  const [token, repo, branch] = await Promise.all([
    githubToken.getValue(),
    repoName.getValue(),
    branchName.getValue(),
  ]);
  if (!token || !repo) throw new Error('Open extension settings and save a GitHub token and repository.');
  if (!REPOSITORY_PATTERN.test(repo)) throw new Error('Repository must use the OWNER/REPOSITORY format.');
  return uploadSolution(token, repo, branch || 'main', payload);
}
