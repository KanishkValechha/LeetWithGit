import { browser } from 'wxt/browser';

type BadgeState = 'uploading' | 'saved' | 'waiting' | 'clear';

const CLEAR_DELAY_MS = 4000;

let clearTimer: ReturnType<typeof setTimeout> | undefined;

// The toolbar badge mirrors the popup: orange while uploading, green briefly after a save,
// amber with a count while uploads wait to retry.
export async function setBadge(state: BadgeState, waiting = 0): Promise<void> {
  clearTimeout(clearTimer);
  const badges: Record<BadgeState, [text: string, color: string]> = {
    uploading: ['↑', '#FFA116'],
    saved: ['✓', '#00B8A3'],
    waiting: [String(waiting), '#F5A524'],
    clear: ['', '#000000'],
  };
  const [text, color] = badges[state];
  await browser.action.setBadgeBackgroundColor({ color });
  await browser.action.setBadgeTextColor({ color: '#0A0A0A' });
  await browser.action.setBadgeText({ text });
  if (state === 'saved') clearTimer = setTimeout(() => void browser.action.setBadgeText({ text: '' }), CLEAR_DELAY_MS);
}
