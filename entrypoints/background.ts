import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { REPOSITORY_PATTERN } from '@/lib/constants';
import { runtimeMessageSchema } from '@/lib/schemas/messages';
import { setBadge } from '@/lib/api/badge';
import { uploadSolution } from '@/lib/api/github';
import {
  activeUpload,
  branchName,
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
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const MAX_RECENT_KEYS = 1000;
const MAX_RECENT_SOLUTIONS = 5;

let processing = false;
// Set when processQueue is called mid-run, e.g. by Retry now, so newly due items are not left for the alarm.
let rerunQueue = false;
let queueLock: Promise<unknown> = Promise.resolve();

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
  });

  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    await migrateLegacyToken();
    await injectIntoOpenLeetCodeTabs(reason === 'install');
    await processQueue();
  });

  browser.runtime.onStartup.addListener(() => void processQueue());
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
  if (await enqueue(payload)) await processQueue();
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
  notify('LeetWithGit', message);
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

function notify(title: string, message: string): void {
  void browser.notifications.create({
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
