import { z } from 'zod';
import { githubRequest } from '@/lib/github';

const viewerSchema = z.object({ login: z.string(), avatar_url: z.string() });
const repositorySchema = z.object({
  full_name: z.string(),
  default_branch: z.string(),
  private: z.boolean(),
  permissions: z.object({ push: z.boolean() }).partial().optional(),
});

export type Viewer = z.infer<typeof viewerSchema>;
export type Repository = z.infer<typeof repositorySchema>;

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

export const NEW_TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?name=LeetWithGit&description=Saves%20accepted%20LeetCode%20solutions&contents=write';
