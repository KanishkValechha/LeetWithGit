import { z } from 'zod';

export const viewerSchema = z.object({ login: z.string(), avatar_url: z.string() });

export const repositorySchema = z.object({
  full_name: z.string(),
  default_branch: z.string(),
  private: z.boolean(),
  permissions: z.object({ push: z.boolean() }).partial().optional(),
});

export const fileSchema = z.object({ sha: z.string() });
export const uploadResponseSchema = z.object({ content: z.object({ html_url: z.string() }) });
export const errorResponseSchema = z.object({ message: z.string() });
