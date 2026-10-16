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

export function problemName(slug: string): string {
  return slug
    .split('-')
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}
