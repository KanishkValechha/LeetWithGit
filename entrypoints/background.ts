import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { REPOSITORY_PATTERN } from '@/lib/constants';
import { dailyQuestionResponseSchema } from '@/lib/schemas/leetcode';
import { runtimeMessageSchema } from '@/lib/schemas/messages';
import { setBadge, type BadgeState } from '@/lib/api/badge';
import { uploadSolution } from '@/lib/api/github';
import {
  activeUpload,
  branchName,
  dailyQuestion,
  githubToken,
  lastSyncStatus,
  migrateLegacyToken,
  pendingSubmissions,
  recentSolutions,
  recentSubmissionKeys,
  repoName,
} from '@/lib/api/storage';
import type { DailyQuestion } from '@/lib/types/leetcode';
import type { RuntimeMessage } from '@/lib/types/messages';
import type { QueuedSubmission, Submission } from '@/lib/types/submission';
import { errorMessage, isLeetCodeUrl, utcDate } from '@/lib/utils/helpers';

const RETRY_ALARM = 'retry-pending-submissions';
const DAILY_QUESTION_ALARM = 'refresh-daily-question';
// Until LeetCode reports today's question solved, check hourly so a solve on another device clears the badge.
const DAILY_REFRESH_MS = 60 * 60 * 1000;
const DAILY_RETRY_MS = 15 * 60 * 1000;
// After a local solve, refresh soon to pick up the new streak.
const DAILY_STREAK_REFRESH_MS = 60 * 1000;
const DAILY_QUESTION_QUERY = `{
  activeDailyCodingChallengeQuestion { date userStatus question { questionId questionFrontendId title titleSlug difficulty } }
  userStatus { isSignedIn }
  streakCounter { streakCount }
}`;
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
const withQueueLock = createLock();
// Keeps a refresh from overwriting a solve that markDailySolved recorded while the refresh was in flight.
const withDailyLock = createLock();

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
    if (alarm.name === DAILY_QUESTION_ALARM) void refreshDailyQuestion();
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
    await refreshDailyQuestion();
  });

  browser.runtime.onStartup.addListener(() => {
    void processQueue();
    void refreshDailyQuestion();
  });
});

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
  await markDailySolved(payload).catch((error: unknown) => {
    console.error('LeetWithGit could not update the daily question:', error);
  });
  if (await enqueue(payload)) await processQueue();
}

// Clears the daily badge as soon as the accepted solution arrives, before the upload and LeetCode's own
// status catch up. A refresh shortly after picks up the new streak.
async function markDailySolved(payload: Submission): Promise<void> {
  const marked = await withDailyLock(async () => {
    const daily = await dailyQuestion.getValue();
    if (!daily || daily.completed || daily.questionId !== payload.questionId || daily.date !== utcDate()) return false;
    await dailyQuestion.setValue({ ...daily, completed: true });
    await scheduleDailyRefresh(Date.now() + DAILY_STREAK_REFRESH_MS);
    return true;
  });
  if (marked) await showIdleBadge();
}

// Runs tasks one at a time, in the order they were queued.
function createLock(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
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
    if (saved && !waiting) {
      const settle = await idleBadge().catch((): BadgeState => 'clear');
      await setBadge('saved', 0, settle).catch(() => {});
    } else if (attempted || waiting) {
      await showIdleBadge();
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

// The upload states own the badge. The daily dot shows only when nothing is uploading or waiting.
async function showIdleBadge(): Promise<void> {
  try {
    const [waiting, state] = await Promise.all([pendingSubmissions.getValue().then((queue) => queue.length), idleBadge()]);
    if (processing) return;
    await setBadge(waiting ? 'waiting' : state, waiting);
  } catch (error: unknown) {
    console.error('LeetWithGit could not update the badge:', error);
  }
}

async function idleBadge(): Promise<BadgeState> {
  const daily = await dailyQuestion.getValue();
  return daily?.signedIn && !daily.completed && daily.date === utcDate() ? 'daily' : 'clear';
}

async function refreshDailyQuestion(): Promise<void> {
  // The request stays outside the lock so a slow LeetCode never delays markDailySolved.
  const fetched = await fetchDailyQuestion()
    .then((daily) => {
      // LeetCode can serve the previous day's question for a moment after UTC midnight.
      if (daily.date !== utcDate()) throw new Error(`LeetCode still returned the daily question for ${daily.date}.`);
      return daily;
    })
    .catch((error: unknown) => {
      console.error('LeetWithGit could not load the daily question:', error);
      return null;
    });

  await withDailyLock(async () => {
    const stored = await dailyQuestion.getValue();
    let nextRefresh = Date.now() + DAILY_RETRY_MS;
    if (fetched) {
      // LeetCode can still report the question unsolved just after markDailySolved saw it accepted.
      const completed =
        fetched.completed ||
        (fetched.signedIn && stored?.completed === true && stored.date === fetched.date && stored.questionId === fetched.questionId);
      await dailyQuestion.setValue({ ...fetched, completed });
      // Wait for midnight only once LeetCode confirms the solve; until then its streak may be stale.
      nextRefresh = fetched.completed ? nextUtcMidnight() : Math.min(nextUtcMidnight(), Date.now() + DAILY_REFRESH_MS);
    } else if (stored && stored.date !== utcDate()) {
      // Ride out a brief outage with today's question, but never show yesterday's.
      await dailyQuestion.setValue(null);
    }
    await scheduleDailyRefresh(nextRefresh);
  });
  await showIdleBadge();
}

// Never postpones a refresh that is already due sooner, such as the streak refresh after a solve.
async function scheduleDailyRefresh(when: number): Promise<void> {
  const pending = await browser.alarms.get(DAILY_QUESTION_ALARM);
  const next = pending && pending.scheduledTime > Date.now() ? Math.min(pending.scheduledTime, when) : when;
  await browser.alarms.create(DAILY_QUESTION_ALARM, { when: next });
}

// The worker's request carries the browser's LeetCode cookies, so the solved state and streak are the user's.
async function fetchDailyQuestion(): Promise<DailyQuestion> {
  const response = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: DAILY_QUESTION_QUERY }),
    credentials: 'include',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`LeetCode returned HTTP ${response.status}.`);
  // GraphQL reports failures with HTTP 200 and an errors array instead of data.
  const { data, errors } = (await response.json()) as { data?: unknown; errors?: { message: string }[] };
  if (errors?.length || !data) throw new Error(errors?.[0]?.message ?? 'LeetCode returned no data.');

  const { activeDailyCodingChallengeQuestion: daily, userStatus, streakCounter } = dailyQuestionResponseSchema.parse(data);
  const signedIn = userStatus?.isSignedIn ?? false;
  return {
    date: daily.date,
    questionId: daily.question.questionId,
    questionNumber: daily.question.questionFrontendId,
    title: daily.question.title,
    difficulty: daily.question.difficulty,
    url: `https://leetcode.com/problems/${daily.question.titleSlug}/`,
    signedIn,
    completed: signedIn && daily.userStatus === 'Finish',
    streak: streakCounter?.streakCount ?? 0,
  };
}

// A minute past midnight, so LeetCode has already switched to the new question.
function nextUtcMidnight(): number {
  const next = new Date();
  next.setUTCHours(24, 1, 0, 0);
  return next.getTime();
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
