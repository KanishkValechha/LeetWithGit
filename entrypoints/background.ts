import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { z } from 'zod';
import { errorMessage } from '@/lib/errors';
import { GitHubError, githubRequest, REPOSITORY_PATTERN } from '@/lib/github';
import { runtimeMessageSchema } from '@/lib/messages';
import {
  branchName,
  githubToken,
  lastSyncStatus,
  migrateLegacyToken,
  pendingSubmissions,
  recentSubmissionKeys,
  repoName,
  type QueuedSubmission,
} from '@/lib/storage';
import type { Submission } from '@/lib/submission';

const RETRY_ALARM = 'retry-pending-submissions';
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const MAX_RECENT_KEYS = 1000;

const fileSchema = z.object({ sha: z.string() });

let processing = false;
let queueLock: Promise<unknown> = Promise.resolve();

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const message = runtimeMessageSchema.safeParse(raw);
    if (!message.success) return false;

    const task =
      message.data.type === 'queue-submission'
        ? queueFromLeetCode(message.data.payload, sender)
        : processQueue();
    task
      .catch((error: unknown) => console.error('LeetWithGit could not handle a message:', error))
      .finally(() => sendResponse());
    return true;
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RETRY_ALARM) void processQueue();
  });

  browser.runtime.onInstalled.addListener(async () => {
    await migrateLegacyToken();
    await processQueue();
  });

  browser.runtime.onStartup.addListener(() => void processQueue());
});

async function queueFromLeetCode(
  payload: Submission,
  sender: Browser.runtime.MessageSender,
): Promise<void> {
  if (!sender.tab || !isLeetCodeUrl(sender.url)) throw new Error('Submission did not come from LeetCode.');
  if (await enqueue(payload)) await processQueue();
}

function isLeetCodeUrl(url: string | undefined): boolean {
  return URL.parse(url ?? '')?.hostname === 'leetcode.com';
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

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const now = Date.now();
    const due = (await pendingSubmissions.getValue()).filter((item) => item.nextAttemptAt <= now);
    for (const item of due) {
      try {
        await pushToGitHub(item.payload);
        await markUploaded(item);
      } catch (error: unknown) {
        await markFailed(item, error);
      }
    }
  } finally {
    processing = false;
    await scheduleRetry().catch((error: unknown) => {
      console.error('LeetWithGit could not schedule queued uploads:', error);
    });
  }
}

async function markUploaded(item: QueuedSubmission): Promise<void> {
  const message = `Saved ${item.payload.problemTitle} to GitHub.`;
  await withQueueLock(async () => {
    const [queue, recent] = await Promise.all([pendingSubmissions.getValue(), recentSubmissionKeys.getValue()]);
    await Promise.all([
      pendingSubmissions.setValue(queue.filter((queued) => queued.submissionKey !== item.submissionKey)),
      recentSubmissionKeys.setValue([...recent, item.submissionKey].slice(-MAX_RECENT_KEYS)),
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
        message: `Could not save ${current.payload.problemTitle}: ${errorMessage(error).replace(/\.$/, '')}. It will retry automatically.`,
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

async function pushToGitHub(payload: Submission): Promise<void> {
  const [token, repo, branch] = await Promise.all([
    githubToken.getValue(),
    repoName.getValue(),
    branchName.getValue(),
  ]);
  if (!token || !repo) throw new Error('Open extension settings and save a GitHub token and repository.');
  if (!REPOSITORY_PATTERN.test(repo)) throw new Error('Repository must use the OWNER/REPOSITORY format.');

  const fileName = buildFileName(payload);
  const path = `/repos/${repo}/contents/leetcode/${encodeURIComponent(fileName)}`;
  const upload = {
    message: `Add LeetCode solution: ${fileName}`,
    content: toBase64(buildFileContent(payload)),
    branch: branch || 'main',
  };

  try {
    await githubRequest(token, path, { method: 'PUT', body: upload });
  } catch (error: unknown) {
    // GitHub answers 422 when the file already exists. It is deleted and re-created; see README.
    if (!(error instanceof GitHubError && error.status === 422)) throw error;

    const { sha } = fileSchema.parse(await githubRequest(token, path));
    await githubRequest(token, path, {
      method: 'DELETE',
      body: { message: `Delete existing LeetCode solution: ${fileName}`, sha, branch: upload.branch },
    });
    await githubRequest(token, path, { method: 'PUT', body: upload });
  }
}

function buildFileName(payload: Submission): string {
  const title = payload.problemTitle
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 100);
  return `${payload.questionId}-${title || 'solution'}.${payload.language.toLowerCase()}`;
}

function buildFileContent(payload: Submission): string {
  return `/*\n * ${payload.problemTitle}\n * Difficulty: ${payload.difficulty}\n *\n * ${payload.description}\n */\n\n${payload.code}`;
}

function toBase64(text: string): string {
  return btoa(Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join(''));
}
