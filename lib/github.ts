import { z } from 'zod';

export const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const errorResponseSchema = z.object({ message: z.string() });

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function githubRequest(
  token: string,
  path: string,
  { method = 'GET', body }: { method?: 'GET' | 'PUT' | 'DELETE'; body?: object } = {},
): Promise<unknown> {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : null,
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new GitHubError(response.status, describeFailure(response.status, data));
  return data;
}

function describeFailure(status: number, data: unknown): string {
  if (status === 401) return 'GitHub rejected the token. Check that it is active.';
  if (status === 404) return 'Repository or branch was not found, or the token cannot access it.';
  const parsed = errorResponseSchema.safeParse(data);
  return parsed.success ? parsed.data.message : `GitHub returned HTTP ${status}.`;
}
