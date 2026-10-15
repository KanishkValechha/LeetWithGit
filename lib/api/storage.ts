import { storage } from 'wxt/utils/storage';
import type { LeetCodeProfile } from '../types/leetcode';
import type { QueuedSubmission } from '../types/submission';
import type { ActiveUpload, SavedSolution, SyncStatus } from '../types/sync';

export const githubToken = storage.defineItem<string>('local:githubToken');
export const repoName = storage.defineItem<string>('sync:repoName', { fallback: '' });
export const branchName = storage.defineItem<string>('sync:branchName', { fallback: 'main' });
export const pendingSubmissions = storage.defineItem<QueuedSubmission[]>('local:pendingSubmissions', { fallback: [] });
export const recentSubmissionKeys = storage.defineItem<string[]>('local:recentSubmissionKeys', { fallback: [] });
export const lastSyncStatus = storage.defineItem<SyncStatus>('local:lastSyncStatus');
export const activeUpload = storage.defineItem<ActiveUpload | null>('local:activeUpload', { fallback: null });
export const recentSolutions = storage.defineItem<SavedSolution[]>('local:recentSolutions', { fallback: [] });
export const leetCodeProfile = storage.defineItem<LeetCodeProfile | null>('local:leetCodeProfile', { fallback: null });

// Versions before 1.6 stored the token in sync storage.
const legacySyncedToken = storage.defineItem<string>('sync:githubToken');

export async function migrateLegacyToken(): Promise<void> {
  const legacyToken = await legacySyncedToken.getValue();
  if (!legacyToken) return;
  if (!(await githubToken.getValue())) await githubToken.setValue(legacyToken);
  await legacySyncedToken.removeValue();
}
