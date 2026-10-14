import { storage } from 'wxt/utils/storage';
import type { Submission } from './submission';

export interface QueuedSubmission {
  payload: Submission;
  submissionKey: string;
  attempts: number;
  nextAttemptAt: number;
}

export interface SyncStatus {
  status: 'success' | 'retrying';
  message: string;
  updatedAt: number;
}

export const githubToken = storage.defineItem<string>('local:githubToken');
export const repoName = storage.defineItem<string>('sync:repoName', { fallback: '' });
export const branchName = storage.defineItem<string>('sync:branchName', { fallback: 'main' });
export const pendingSubmissions = storage.defineItem<QueuedSubmission[]>('local:pendingSubmissions', { fallback: [] });
export const recentSubmissionKeys = storage.defineItem<string[]>('local:recentSubmissionKeys', { fallback: [] });
export const lastSyncStatus = storage.defineItem<SyncStatus>('local:lastSyncStatus');

// Versions before 1.6 stored the token in sync storage.
const legacySyncedToken = storage.defineItem<string>('sync:githubToken');

export async function migrateLegacyToken(): Promise<void> {
  const legacyToken = await legacySyncedToken.getValue();
  if (!legacyToken) return;
  if (!(await githubToken.getValue())) await githubToken.setValue(legacyToken);
  await legacySyncedToken.removeValue();
}
