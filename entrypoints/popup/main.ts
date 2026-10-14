import { z } from 'zod';
import { errorMessage } from '@/lib/errors';
import { githubRequest, REPOSITORY_PATTERN } from '@/lib/github';
import { sendMessage } from '@/lib/messages';
import { branchName, githubToken, lastSyncStatus, repoName, type SyncStatus } from '@/lib/storage';

type StatusTone = 'success' | 'error' | 'neutral';

const TOKEN_SAVED = 'A token is saved on this browser. Leave this field blank to keep it.';
const TOKEN_MISSING = 'No token saved yet. It is kept on this browser and is not synced.';

const repositorySchema = z.object({
  permissions: z.object({ push: z.boolean() }).partial().optional(),
});

const tokenInput = element('github-token', HTMLInputElement);
const repoInput = element('repo-name', HTMLInputElement);
const branchInput = element('branch-name', HTMLInputElement);
const tokenState = element('token-state', HTMLElement);
const statusElement = element('status', HTMLElement);
const syncStatusElement = element('sync-status', HTMLElement);
const buttons = [element('save', HTMLButtonElement), element('test-connection', HTMLButtonElement)] as const;

buttons[0].addEventListener('click', () => void saveSettings());
buttons[1].addEventListener('click', () => void testConnection());
lastSyncStatus.watch(renderSyncStatus);
loadSettings().catch((error: unknown) => showStatus(`Could not load settings: ${errorMessage(error)}`, 'error'));

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`Popup element "${id}" is missing.`);
  return found;
}

async function loadSettings(): Promise<void> {
  const [token, repo, branch, syncStatus] = await Promise.all([
    githubToken.getValue(),
    repoName.getValue(),
    branchName.getValue(),
    lastSyncStatus.getValue(),
  ]);
  repoInput.value = repo;
  branchInput.value = branch;
  tokenState.textContent = token ? TOKEN_SAVED : TOKEN_MISSING;
  renderSyncStatus(syncStatus);
}

function readForm(): { token: string; repo: string; branch: string } | null {
  const repo = repoInput.value.trim();
  if (!REPOSITORY_PATTERN.test(repo)) {
    showStatus('Enter a repository as OWNER/REPOSITORY.', 'error');
    return null;
  }
  return { token: tokenInput.value.trim(), repo, branch: branchInput.value.trim() || 'main' };
}

async function saveSettings(): Promise<void> {
  const form = readForm();
  if (!form) return;
  if (!form.token && !(await githubToken.getValue())) {
    showStatus('Add a GitHub token before saving settings.', 'error');
    return;
  }

  await whileBusy('Could not save settings', async () => {
    if (form.token) await githubToken.setValue(form.token);
    await Promise.all([repoName.setValue(form.repo), branchName.setValue(form.branch)]);
    tokenInput.value = '';
    tokenState.textContent = TOKEN_SAVED;
    showStatus('Settings saved. Testing the connection is recommended.', 'success');
    sendMessage({ type: 'process-queue' }).catch(() => {});
  });
}

async function testConnection(): Promise<void> {
  const form = readForm();
  if (!form) return;
  const token = form.token || (await githubToken.getValue());
  if (!token) {
    showStatus('Enter a GitHub token to test the connection.', 'error');
    return;
  }

  await whileBusy('Connection check failed', async () => {
    showStatus('Checking token, repository, and branch…', 'neutral');
    const repository = repositorySchema.parse(await githubRequest(token, `/repos/${form.repo}`));
    await githubRequest(token, `/repos/${form.repo}/branches/${encodeURIComponent(form.branch)}`);
    if (repository.permissions?.push === false) {
      throw new Error('The token can read this repository but does not have write access.');
    }
    showStatus(
      `Connection works. Repository and branch “${form.branch}” are accessible. Confirm the token has Contents: Read and write to upload solutions.`,
      'success',
    );
  });
}

async function whileBusy(failurePrefix: string, task: () => Promise<void>): Promise<void> {
  for (const button of buttons) button.disabled = true;
  try {
    await task();
  } catch (error: unknown) {
    showStatus(`${failurePrefix}: ${errorMessage(error)}`, 'error');
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}

function renderSyncStatus(syncStatus: SyncStatus | null): void {
  syncStatusElement.textContent = syncStatus ? `Latest sync: ${syncStatus.message}` : '';
  syncStatusElement.className = `status ${syncStatus?.status === 'success' ? 'success' : 'neutral'}`;
}

function showStatus(message: string, tone: StatusTone): void {
  statusElement.textContent = message;
  statusElement.className = `status ${tone}`;
}
