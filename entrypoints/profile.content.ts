import { defineContentScript } from 'wxt/utils/define-content-script';
import { PAGE_PROFILE_MESSAGE, PAGE_SUBMISSION_MESSAGE } from '@/lib/constants';
import type { DifficultyCounts, LeetCodeProfile } from '@/lib/types/leetcode';

interface DifficultyCount {
  difficulty: string;
  count: number;
}

interface ProfileStats {
  allQuestionsCount: DifficultyCount[];
  matchedUser: { submitStatsGlobal: { acSubmissionNum: DifficultyCount[] } } | null;
}

const STATS_QUERY = `query ($username: String!) {
  allQuestionsCount { difficulty count }
  matchedUser(username: $username) { submitStatsGlobal { acSubmissionNum { difficulty count } } }
}`;

// Runs in LeetCode's page world so its GraphQL requests carry the signed-in session.
// It hands the solved counts to leetcode.content.ts, which stores them for the popup.
export default defineContentScript({
  matches: ['https://leetcode.com/*'],
  world: 'MAIN',
  main() {
    const profileWindow = window as Window & { __leetWithGitProfileInitialized?: boolean };
    const refresh = () =>
      publishProfile().catch((error: unknown) => console.error('LeetWithGit could not load your LeetCode stats:', error));
    void refresh();
    // Reinjection refreshes stats, but the page needs only one submission listener.
    if (profileWindow.__leetWithGitProfileInitialized) return;
    profileWindow.__leetWithGitProfileInitialized = true;
    // An accepted submission changes the solved counts.
    window.addEventListener('message', (event: MessageEvent<{ type?: unknown } | null>) => {
      if (event.source === window && event.data?.type === PAGE_SUBMISSION_MESSAGE) void refresh();
    });
  },
});

async function publishProfile(): Promise<void> {
  const { userStatus } = await graphql<{ userStatus: { username: string; isSignedIn: boolean } }>(
    '{ userStatus { username isSignedIn } }',
  );
  // Signed out: clear the stored stats so the popup stops showing the previous account.
  if (!userStatus.isSignedIn) return post(null);

  const stats = await graphql<ProfileStats>(STATS_QUERY, { username: userStatus.username });
  if (!stats.matchedUser) throw new Error(`LeetCode has no profile for ${userStatus.username}.`);
  post({
    username: userStatus.username,
    solved: byDifficulty(stats.matchedUser.submitStatsGlobal.acSubmissionNum),
    total: byDifficulty(stats.allQuestionsCount),
  });
}

function post(profile: LeetCodeProfile | null): void {
  window.postMessage({ type: PAGE_PROFILE_MESSAGE, payload: profile }, location.origin);
}

function byDifficulty(counts: DifficultyCount[]): DifficultyCounts {
  const count = (difficulty: string) => counts.find((item) => item.difficulty === difficulty)?.count ?? 0;
  return { easy: count('Easy'), medium: count('Medium'), hard: count('Hard') };
}

async function graphql<T>(query: string, variables: Record<string, string> = {}): Promise<T> {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`LeetCode returned HTTP ${response.status}.`);
  // GraphQL reports failures with HTTP 200 and an errors array instead of data.
  const { data, errors } = (await response.json()) as { data?: T | null; errors?: { message: string }[] };
  if (errors?.length || !data) throw new Error(errors?.[0]?.message ?? 'LeetCode returned no data.');
  return data;
}
