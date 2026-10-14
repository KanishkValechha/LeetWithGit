interface SubmissionPayload {
  submissionId?: string;
  questionId: string;
  problemTitle: string;
  language: string;
  difficulty?: string;
  description?: string;
  code: string;
}

interface QueuedSubmission {
  payload: SubmissionPayload;
  submissionKey: string;
  attempts: number;
  nextAttemptAt: number;
}

interface SyncStatus {
  status: "success" | "retrying";
  message: string;
  updatedAt: number;
}

interface LocalExtensionData {
  githubToken?: string;
  pendingSubmissions?: QueuedSubmission[];
  recentSubmissionKeys?: string[];
  lastSyncStatus?: SyncStatus;
}

interface SyncedExtensionData {
  repoName?: string;
  branchName?: string;
  githubToken?: string;
}

interface LeetCodeProblemDetails {
  title: string;
  difficulty: string;
  description: string;
}

interface GitHubRepositoryResponse {
  permissions?: { push?: boolean };
}

interface Window {
  __leetWithGitCaptureInstalled?: boolean;
}
