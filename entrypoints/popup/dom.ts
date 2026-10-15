type Child = Node | string | false | null | undefined;
type Props = Record<string, string | boolean | EventListener | undefined>;

// Small element builder. Text children are always inserted as text, never parsed as HTML.
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') element.addEventListener(key.replace(/^on/, ''), value);
    else if (value === true) element.setAttribute(key, '');
    else element.setAttribute(key, value);
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

// Icons are static markup owned by the extension.
export function icon(name: keyof typeof ICONS, className = 'icon'): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = ICONS[name].replace('<svg ', `<svg class="${className}" aria-hidden="true" `);
  return template.content.firstElementChild as SVGSVGElement;
}

const stroke = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

const ICONS = {
  logo: `<svg viewBox="0 0 64 64"><rect x="0.5" y="0.5" width="63" height="63" rx="14" fill="#0F0F0F" stroke="#2A2A2A"/><polyline class="logo-path" points="15,32 27,44 49,20" fill="none" stroke="#F5F5F5" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle class="logo-node" cx="15" cy="32" r="5.5" fill="#0F0F0F" stroke="#F5F5F5" stroke-width="4"/><circle class="logo-node" cx="27" cy="44" r="5.5" fill="#0F0F0F" stroke="#F5F5F5" stroke-width="4"/><circle class="logo-head" cx="49" cy="20" r="7" fill="#FFA116"/></svg>`,
  branch: `<svg viewBox="0 0 16 16" ${stroke}><circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5" r="1.5"/><path d="M4.5 5v6M11.5 6.5c0 3-7 2-7 4.5"/></svg>`,
  sliders: `<svg viewBox="0 0 16 16" ${stroke}><path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6"/><circle cx="10" cy="4.5" r="1.5"/><circle cx="6" cy="11.5" r="1.5"/></svg>`,
  back: `<svg viewBox="0 0 16 16" ${stroke}><path d="M10 3.5L5.5 8l4.5 4.5"/></svg>`,
  arrow: `<svg viewBox="0 0 16 16" ${stroke}><path d="M3 8h10M9 4l4 4-4 4"/></svg>`,
  external: `<svg viewBox="0 0 16 16" ${stroke}><path d="M6 3.5H3.5v9h9V10M9 3h4v4M13 3L7.5 8.5"/></svg>`,
  check: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="check-path" d="M3.5 8.5l3 3 6-7"/></svg>`,
  lock: `<svg viewBox="0 0 16 16" ${stroke}><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>`,
  retry: `<svg viewBox="0 0 16 16" ${stroke}><path d="M13 8a5 5 0 11-1.5-3.5M13 2.5V5h-2.5"/></svg>`,
  eye: `<svg viewBox="0 0 16 16" ${stroke}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>`,
  key: `<svg viewBox="0 0 16 16" ${stroke}><circle cx="5" cy="11" r="2.5"/><path d="M6.8 9.2L13 3M11 5l1.5 1.5"/></svg>`,
} as const;

export function timeAgo(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function timeUntil(timestamp: number, now = Date.now()): string {
  const seconds = Math.round((timestamp - now) / 1000);
  if (seconds <= 5) return 'shortly';
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `in ${minutes}m` : `in ${Math.round(minutes / 60)}h`;
}

export function difficultyClass(difficulty: string): string {
  const value = difficulty.toLowerCase();
  return value === 'easy' || value === 'medium' || value === 'hard' ? value : 'unknown';
}

// LeetCode sends language slugs such as "python3" or "cpp"; show them the way LeetCode labels them.
const LANGUAGE_LABELS: Record<string, string> = {
  cpp: 'C++',
  java: 'Java',
  python: 'Python',
  python3: 'Python3',
  c: 'C',
  csharp: 'C#',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  php: 'PHP',
  swift: 'Swift',
  kotlin: 'Kotlin',
  dart: 'Dart',
  golang: 'Go',
  ruby: 'Ruby',
  scala: 'Scala',
  rust: 'Rust',
  racket: 'Racket',
  erlang: 'Erlang',
  elixir: 'Elixir',
  mysql: 'MySQL',
  mssql: 'MS SQL',
  oraclesql: 'Oracle',
  postgresql: 'PostgreSQL',
  pandas: 'Pandas',
  bash: 'Bash',
};

export function languageLabel(language: string): string {
  return LANGUAGE_LABELS[language.toLowerCase()] ?? language;
}
