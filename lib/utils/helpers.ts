export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isLeetCodeUrl(url: string | undefined): boolean {
  return URL.parse(url ?? '')?.hostname === 'leetcode.com';
}

export function toBase64(text: string): string {
  return btoa(Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join(''));
}

export function maskToken(token: string): string {
  return `${token.slice(0, token.startsWith('github_pat_') ? 11 : 4)}••••${token.slice(-4)}`;
}

// LeetCode rotates the daily question at midnight UTC and dates it by the UTC day.
export function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
