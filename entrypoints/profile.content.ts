import { defineContentScript } from 'wxt/utils/define-content-script';
import type { LeetCodeProfile } from '@/lib/leetcode-profile';
import { PAGE_PROFILE_MESSAGE, PAGE_SUBMISSION_MESSAGE } from '@/lib/page-message';

interface DifficultyCount {
  difficulty: string;
  count: number;
}

interface ProfileStats {
  allQuestionsCount: DifficultyCount[];
  matchedUser: { submitStatsGlobal: { acSubmissionNum: DifficultyCount[] } };
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
    const refresh = () =>
      publishProfile().catch((error: unknown) => console.error('LeetWithGit could not load your LeetCode stats:', error));
    void refresh();
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
  if (!userStatus.isSignedIn) return;

  const stats = await graphql<ProfileStats>(STATS_QUERY, { username: userStatus.username });
  const profile: LeetCodeProfile = {
    username: userStatus.username,
    solved: byDifficulty(stats.matchedUser.submitStatsGlobal.acSubmissionNum),
    total: byDifficulty(stats.allQuestionsCount),
  };
  window.postMessage({ type: PAGE_PROFILE_MESSAGE, payload: profile }, location.origin);
}

function byDifficulty(counts: DifficultyCount[]): LeetCodeProfile['solved'] {
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
  const { data } = (await response.json()) as { data: T };
  return data;
}
