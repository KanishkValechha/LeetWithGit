import type { Submission } from '../types/submission';

export function buildFileName(payload: Submission): string {
  const title = payload.problemTitle
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 100);
  return `${payload.questionId}-${title || 'solution'}.${payload.language.toLowerCase()}`;
}

export function buildFileContent(payload: Submission): string {
  return `/*\n * ${payload.problemTitle}\n * Difficulty: ${payload.difficulty}\n *\n * ${payload.description}\n */\n\n${payload.code}`;
}
