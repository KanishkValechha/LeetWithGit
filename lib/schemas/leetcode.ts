import { z } from 'zod';

const countsSchema = z.object({ easy: z.number(), medium: z.number(), hard: z.number() });

export const leetCodeProfileSchema = z.object({
  username: z.string().min(1),
  solved: countsSchema,
  total: countsSchema,
});
