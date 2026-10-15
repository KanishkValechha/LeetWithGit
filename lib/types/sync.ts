import type { Submission } from './submission';

export type SolutionSummary = Pick<Submission, 'problemTitle' | 'difficulty' | 'language'>;

export interface ActiveUpload extends SolutionSummary {
  startedAt: number;
}

export interface SavedSolution extends SolutionSummary {
  fileUrl: string;
  savedAt: number;
}

export interface SyncStatus {
  status: 'success' | 'retrying';
  message: string;
  updatedAt: number;
}
