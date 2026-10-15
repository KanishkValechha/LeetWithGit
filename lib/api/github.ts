import { z } from 'zod';
import { errorResponseSchema, fileSchema, repositorySchema, uploadResponseSchema, viewerSchema } from '../schemas/github';
import type { Repository, Viewer } from '../types/github';
import type { Submission } from '../types/submission';
import { toBase64 } from '../utils/helpers';
import { buildFileContent, buildFileName } from '../utils/solution-file';

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

export async function fetchViewer(token: string): Promise<Viewer> {
  return viewerSchema.parse(await githubRequest(token, '/user'));
}

// A fine-grained token only lists the repositories it was granted.
export async function listWritableRepositories(token: string): Promise<Repository[]> {
  const repositories = z
    .array(repositorySchema)
    .parse(await githubRequest(token, '/user/repos?per_page=100&sort=pushed'));
  return repositories.filter((repository) => repository.permissions?.push !== false);
}

export async function verifyRepository(token: string, repo: string, branch: string): Promise<void> {
  const repository = repositorySchema.parse(await githubRequest(token, `/repos/${repo}`));
  await githubRequest(token, `/repos/${repo}/branches/${encodeURIComponent(branch)}`);
  if (repository.permissions?.push === false) {
    throw new Error('This token can read the repository but cannot write to it.');
  }
}

// Saves the solution under leetcode/ and returns the file's URL on GitHub.
export async function uploadSolution(token: string, repo: string, branch: string, payload: Submission): Promise<string> {
  const fileName = buildFileName(payload);
  const path = `/repos/${repo}/contents/leetcode/${encodeURIComponent(fileName)}`;
  const upload = {
    message: `Add LeetCode solution: ${fileName}`,
    content: toBase64(buildFileContent(payload)),
    branch,
  };

  const put = async () => {
    const response = uploadResponseSchema.safeParse(await githubRequest(token, path, { method: 'PUT', body: upload }));
    return response.success
      ? response.data.content.html_url
      : `https://github.com/${repo}/blob/${branch}/leetcode/${encodeURIComponent(fileName)}`;
  };

  try {
    return await put();
  } catch (error: unknown) {
    // GitHub answers 422 when the file already exists. It is deleted and re-created; see README.
    if (!(error instanceof GitHubError && error.status === 422)) throw error;

    const { sha } = fileSchema.parse(await githubRequest(token, path));
    await githubRequest(token, path, {
      method: 'DELETE',
      body: { message: `Delete existing LeetCode solution: ${fileName}`, sha, branch },
    });
    return put();
  }
}
