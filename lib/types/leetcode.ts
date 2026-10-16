import type { z } from 'zod';
import type { leetCodeProfileSchema } from '../schemas/leetcode';

export type LeetCodeProfile = z.infer<typeof leetCodeProfileSchema>;
export type DifficultyCounts = LeetCodeProfile['solved'];
