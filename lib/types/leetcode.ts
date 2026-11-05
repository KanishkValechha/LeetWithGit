import type { z } from 'zod';
import type { leetCodeProfileSchema } from '../schemas/leetcode';

export type LeetCodeProfile = z.infer<typeof leetCodeProfileSchema>;
export type DifficultyCounts = LeetCodeProfile['solved'];

export interface DailyQuestion {
  // The UTC day LeetCode assigned this question, as YYYY-MM-DD.
  date: string;
  // LeetCode's internal ID, which accepted submissions carry.
  questionId: string;
  // The number LeetCode shows next to the title.
  questionNumber: string;
  title: string;
  difficulty: string;
  url: string;
  signedIn: boolean;
  completed: boolean;
  streak: number;
}
