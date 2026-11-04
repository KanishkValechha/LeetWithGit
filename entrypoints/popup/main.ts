import './style.css';
import { browser } from 'wxt/browser';
import {
  activeUpload,
  branchName,
  githubToken,
  lastSyncStatus,
  leetCodeProfile,
  pendingSubmissions,
  recentSolutions,
  repoName,
} from '@/lib/api/storage';
import { errorMessage } from '@/lib/utils/helpers';
import { h } from './dom';
import { homeView, type HomeData } from './views/home';
import { settingsView } from './views/settings';
import { setupView } from './views/setup';

type Screen = 'setup' | 'home' | 'settings';

const root = document.getElementById('app');
if (!root) throw new Error('Popup root is missing.');
let screen: Screen = 'setup';
const DAILY_QUESTION_FALLBACK = 'https://leetcode.com/problemset/';
let dailyQuestionUrlPromise: Promise<{ url: string; streak: number; isCompleted: boolean } | null> | null = null;
let dailyQuestionUrl = DAILY_QUESTION_FALLBACK;
let currentStreak = 0;
let isDailyQuestionCompleted = false;

function mount(view: Node, animate = true): void {
  // Live refreshes that change nothing visible would only restart running animations.
  if (!animate && root!.firstChild?.isEqualNode(view)) return;
  root!.replaceChildren(view);
  root!.classList.toggle('enter', animate);
}

async function start(): Promise<void> {
  const [token, repo] = await Promise.all([githubToken.getValue(), repoName.getValue()]);
  if (token && repo) await showHome();
  else showSetup();
}

function showSetup(): void {
  screen = 'setup';
  mount(setupView({ onConnected: () => void showHome() }));
}

async function showHome(animate = true): Promise<void> {
  screen = 'home';
  const data = await loadHomeData();
  if (screen !== 'home') return;
  mount(homeView(data, { onSettings: () => void showSettings() }), animate);
}

async function showSettings(): Promise<void> {
  screen = 'settings';
  const [token, repo, branch] = await Promise.all([githubToken.getValue(), repoName.getValue(), branchName.getValue()]);
  mount(
    settingsView(
      { token, repo, branch },
      {
        onBack: () => void showHome(),
        onDisconnected: showSetup,
      },
    ),
  );
}

async function loadHomeData(): Promise<HomeData> {
  const [repo, branch, recent, profile, queue, active, status, tabProblem] = await Promise.all([
    repoName.getValue(),
    branchName.getValue(),
    recentSolutions.getValue(),
    leetCodeProfile.getValue(),
    pendingSubmissions.getValue(),
    activeUpload.getValue(),
    lastSyncStatus.getValue(),
    currentLeetCodeProblem(),
  ]);
  return { repo, branch, recent, profile, queue, active, status, tabProblem, dailyQuestionUrl, currentStreak, isDailyQuestionCompleted };
}

function currentDailyQuestionUrl(): Promise<{ url: string; streak: number; isCompleted: boolean } | null> {
  dailyQuestionUrlPromise ??= fetchDailyQuestionData().catch(() => null);
  return dailyQuestionUrlPromise;
}

async function fetchDailyQuestionData(): Promise<{ url: string; streak: number; isCompleted: boolean } | null> {
  const response = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query:
        '{ activeDailyCodingChallengeQuestion { question { titleSlug } userStatus } }',
    }),
    credentials: 'include',
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Daily question lookup failed (${response.status}).`);

  const result = (await response.json()) as {
    data?: {
      activeDailyCodingChallengeQuestion?: {
        question?: { titleSlug?: string } | null;
        userStatus?: string | null;
      } | null;
    };
    errors?: { message: string }[];
  };
  if (result.errors?.length || !result.data) throw new Error(result.errors?.[0]?.message ?? 'Daily question lookup failed.');

  const slug = result.data.activeDailyCodingChallengeQuestion?.question?.titleSlug;
  const completionStatus = result.data.activeDailyCodingChallengeQuestion?.userStatus;
  const isCompleted = completionStatus === 'ac' || completionStatus === 'AC';

  const url = typeof slug === 'string' && /^[a-z0-9-]+$/i.test(slug)
    ? `https://leetcode.com/problems/${encodeURIComponent(slug)}/description/`
    : DAILY_QUESTION_FALLBACK;

  // Fetch streak from panelQuestionList
  let streak = 0;
  if (slug) {
    streak = await fetchDailyStreakFromPanel(slug).catch(() => 0);
  }

  return { url, streak, isCompleted };
}

async function fetchDailyStreakFromPanel(currentQuestionSlug: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const response = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query panelQuestionList($currentQuestionSlug: String!, $envId: String, $envType: String) {
        panelQuestionList(
          currentQuestionSlug: $currentQuestionSlug
          envId: $envId
          envType: $envType
        ) {
          finishedLength
        }
      }`,
      variables: {
        currentQuestionSlug,
        envId: today,
        envType: 'daily-question',
      },
    }),
    credentials: 'include',
    signal: AbortSignal.timeout(3000),
  });

  if (!response.ok) throw new Error(`Streak lookup failed (${response.status}).`);

  const result = (await response.json()) as {
    data?: {
      panelQuestionList?: { finishedLength?: number } | null;
    };
    errors?: { message: string }[];
  };

  if (result.errors?.length) throw new Error(result.errors[0]?.message ?? 'Streak lookup failed.');

  return result.data?.panelQuestionList?.finishedLength ?? 0;
}

// The extension has host access to leetcode.com, so the active tab's URL is visible there.
async function currentLeetCodeProblem(): Promise<string | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = URL.parse(tab?.url ?? '');
    if (url?.hostname !== 'leetcode.com') return null;
    return url.pathname.match(/^\/problems\/([^/]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function refreshHome(): void {
  if (screen === 'home') void showHome(false);
}

for (const item of [pendingSubmissions, activeUpload, recentSolutions, leetCodeProfile, lastSyncStatus]) item.watch(refreshHome);
// Keeps relative times and retry countdowns current while the popup stays open.
setInterval(refreshHome, 10_000);

void currentDailyQuestionUrl().then((data) => {
  if (data) {
    dailyQuestionUrl = data.url;
    currentStreak = data.streak;
    isDailyQuestionCompleted = data.isCompleted;
  }
  refreshHome();
});

start().catch((error: unknown) => {
  mount(h('p', { class: 'fatal' }, `Could not load LeetWithGit: ${errorMessage(error)}`));
});
