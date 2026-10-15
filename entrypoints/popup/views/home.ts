import { sendMessage } from '@/lib/api/messages';
import type { LeetCodeProfile } from '@/lib/types/leetcode';
import type { QueuedSubmission } from '@/lib/types/submission';
import type { ActiveUpload, SavedSolution, SolutionSummary, SyncStatus } from '@/lib/types/sync';
import { difficultyClass, languageLabel, problemName, timeAgo, timeUntil } from '@/lib/utils/format';
import { h } from '../dom';
import { icon } from '../icons';

export interface HomeData {
  repo: string;
  branch: string;
  recent: SavedSolution[];
  profile: LeetCodeProfile | null;
  queue: QueuedSubmission[];
  active: ActiveUpload | null;
  status: SyncStatus | null;
  tabProblem: string | null;
}

const JUST_SAVED_MS = 45_000;
// An upload that has not finished by now was interrupted, e.g. by the service worker stopping.
const STALE_UPLOAD_MS = 2 * 60_000;

// The saved card celebrates once per upload, not on every refresh while it stays visible.
let celebratedAt = 0;

export function homeView(data: HomeData, { onSettings }: { onSettings: () => void }): HTMLElement {
  const activity = activityCard(data);
  const content =
    data.profile || data.recent.length
      ? [
          activity ?? idleRow(data.tabProblem),
          data.profile && statsBlock(data.profile),
          data.recent.length > 0 && recentList(data.recent),
        ]
      : [activity ?? allSet(), !activity && leetCodeButton(data.tabProblem)];

  return h(
    'div',
    { class: 'screen home' },
    h(
      'header',
      { class: 'bar' },
      h('div', { class: 'brand' }, icon('logo', 'logo-sm'), h('span', null, 'Leet', h('span', { class: 'brand-with' }, 'with'), 'Git')),
      h(
        'button',
        { class: 'icon-button', type: 'button', title: 'Settings', 'aria-label': 'Settings', onclick: onSettings },
        icon('sliders'),
      ),
    ),
    repoStrip(data.repo, data.branch),
    h('div', { class: 'home-body stagger' }, ...content),
  );
}

function activityCard(data: HomeData): HTMLElement | null {
  const now = Date.now();
  if (data.active && now - data.active.startedAt < STALE_UPLOAD_MS) return uploadingCard(data.active);
  if (data.queue.length) return waitingCard(data.queue, data.status);
  const [latest] = data.recent;
  if (latest && now - latest.savedAt < JUST_SAVED_MS) return savedCard(latest);
  return null;
}

function repoStrip(repo: string, branch: string): HTMLElement {
  return h(
    'a',
    { class: 'repo-strip', href: `https://github.com/${repo}/tree/${encodeURIComponent(branch)}/leetcode`, target: '_blank' },
    h('span', { class: 'live-dot', title: 'Connected' }),
    h('span', { class: 'repo-name mono' }, repo),
    h('span', { class: 'branch mono' }, icon('branch', 'icon-xs'), branch),
    icon('external', 'icon-xs repo-open'),
  );
}

function allSet(): HTMLElement {
  return h(
    'section',
    { class: 'all-set' },
    h('div', { class: 'hero-mark draw' }, icon('logo', 'logo-lg')),
    h('h1', null, 'You’re all set'),
    h('p', { class: 'muted' }, 'Accepted solutions land in ', h('span', { class: 'mono path' }, 'leetcode/')),
  );
}

function leetCodeButton(tabProblem: string | null): HTMLElement {
  if (tabProblem) {
    return h('p', { class: 'watching-note' }, icon('eye', 'icon-xs'), 'Watching ', h('strong', null, problemName(tabProblem)));
  }
  return h(
    'a',
    { class: 'button secondary', href: 'https://leetcode.com/problemset/', target: '_blank' },
    'Open LeetCode',
    icon('external', 'icon-sm'),
  );
}

function idleRow(tabProblem: string | null): HTMLElement {
  return h(
    'div',
    { class: 'idle-row' },
    h('span', { class: 'idle-icon' }, icon(tabProblem ? 'eye' : 'check', 'icon-sm')),
    tabProblem
      ? h('span', null, 'Watching ', h('strong', null, problemName(tabProblem)))
      : h('span', null, 'Ready for your next accepted solution'),
  );
}

function uploadingCard(upload: ActiveUpload): HTMLElement {
  return h(
    'section',
    { class: 'activity uploading', 'aria-live': 'polite' },
    activityHead('Uploading', upload),
    h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Uploading solution' }, h('span')),
    h(
      'ol',
      { class: 'stages' },
      h('li', { class: 'done' }, icon('check', 'icon-xs'), 'Accepted'),
      h('li', { class: 'current' }, h('span', { class: 'spinner sm' }), 'Committing'),
      h('li', null, h('span', { class: 'stage-dot' }), 'Saved'),
    ),
  );
}

function savedCard(solution: SavedSolution): HTMLElement {
  const fresh = solution.savedAt !== celebratedAt;
  celebratedAt = solution.savedAt;
  return h(
    'a',
    { class: `activity saved${fresh ? ' fresh' : ''}`, href: solution.fileUrl, target: '_blank', 'aria-live': 'polite' },
    activityHead('Saved', solution),
    h('span', { class: 'saved-check' }, icon('check', 'icon-sm')),
  );
}

function waitingCard(queue: QueuedSubmission[], status: SyncStatus | null): HTMLElement {
  const next = Math.min(...queue.map((item) => item.nextAttemptAt));
  const reason = status?.status === 'retrying' ? status.message : null;
  const retry = h(
    'button',
    {
      type: 'button',
      class: 'button small',
      onclick: () => {
        retry.setAttribute('disabled', '');
        retry.replaceChildren(h('span', { class: 'spinner sm' }), 'Retrying');
        sendMessage({ type: 'retry-now' }).catch(() => {});
      },
    },
    icon('retry', 'icon-xs'),
    'Retry now',
  );
  return h(
    'section',
    { class: 'activity waiting' },
    activityHead(queue.length === 1 ? 'Waiting to upload' : `${queue.length} waiting to upload`, queue[0]!.payload),
    reason && h('p', { class: 'reason' }, reason),
    h('div', { class: 'activity-foot' }, h('span', { class: 'dim' }, `Retrying ${timeUntil(next)}`), retry),
  );
}

function activityHead(label: string, { problemTitle, difficulty, language }: SolutionSummary): HTMLElement {
  return h(
    'div',
    { class: 'activity-head' },
    h('span', { class: 'eyebrow' }, label),
    h('span', { class: 'activity-title' }, problemTitle),
    h(
      'span',
      { class: 'meta' },
      h('span', { class: `difficulty ${difficultyClass(difficulty)}` }, difficulty),
      h('span', { class: 'mono dim' }, languageLabel(language)),
    ),
  );
}

function statsBlock({ username, solved, total }: LeetCodeProfile): HTMLElement {
  const difficulties = [
    ['easy', 'Easy'],
    ['medium', 'Medium'],
    ['hard', 'Hard'],
  ] as const;
  return h(
    'section',
    { class: 'stats' },
    h(
      'div',
      { class: 'stats-head' },
      h('span', { class: 'stats-number' }, String(solved.easy + solved.medium + solved.hard)),
      h('span', { class: 'dim' }, 'solved'),
      h(
        'a',
        { class: 'link mono stats-user', href: `https://leetcode.com/u/${encodeURIComponent(username)}/`, target: '_blank' },
        `@${username}`,
      ),
    ),
    ...difficulties.map(([key, label]) =>
      h(
        'div',
        { class: `stats-row ${key}` },
        h('span', null, label),
        h(
          'span',
          { class: 'stats-track' },
          h('span', { class: 'stats-fill', style: `width:${total[key] ? (solved[key] / total[key]) * 100 : 0}%` }),
        ),
        h('span', { class: 'stats-count mono' }, String(solved[key]), h('span', { class: 'dim' }, ` / ${total[key]}`)),
      ),
    ),
  );
}

function recentList(solutions: SavedSolution[]): HTMLElement {
  const now = Date.now();
  return h(
    'section',
    { class: 'recent' },
    h('h2', { class: 'section-label' }, 'Recent'),
    h(
      'ul',
      { class: 'recent-list' },
      ...solutions.map((solution) =>
        h(
          'li',
          null,
          h(
            'a',
            { class: 'recent-row', href: solution.fileUrl, target: '_blank', title: 'Open on GitHub' },
            h('span', { class: `tick ${difficultyClass(solution.difficulty)}` }),
            h('span', { class: 'recent-title' }, solution.problemTitle),
            h('span', { class: 'recent-lang mono' }, languageLabel(solution.language)),
            h('span', { class: 'recent-time mono' }, timeAgo(solution.savedAt, now)),
          ),
        ),
      ),
    ),
  );
}
