import { browser } from 'wxt/browser';

export type BadgeState = 'uploading' | 'saved' | 'waiting' | 'clear' | 'daily';

const CLEAR_DELAY_MS = 4000;

let clearTimer: ReturnType<typeof setTimeout> | undefined;

// The toolbar badge mirrors the popup: orange while uploading, green briefly after a save,
// amber with a count while uploads wait to retry. When idle, a red dot means today's daily question is unsolved.
// `settle` is the state the saved check gives way to.
export async function setBadge(state: BadgeState, waiting = 0, settle: BadgeState = 'clear'): Promise<void> {
  clearTimeout(clearTimer);
  const badges: Record<BadgeState, [text: string, color: string]> = {
    uploading: ['↑', '#FFA116'],
    saved: ['✓', '#00B8A3'],
    waiting: [String(waiting), '#F5A524'],
    daily: ['●', '#FF375F'],
    clear: ['', '#000000'],
  };
  const [text, color] = badges[state];
  await browser.action.setBadgeBackgroundColor({ color });
  await browser.action.setBadgeTextColor({ color: '#0A0A0A' });
  await browser.action.setBadgeText({ text });
  if (state === 'saved') clearTimer = setTimeout(() => void setBadge(settle).catch(() => {}), CLEAR_DELAY_MS);
}
