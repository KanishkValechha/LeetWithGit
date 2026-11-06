import { z } from 'zod';

const countsSchema = z.object({ easy: z.number(), medium: z.number(), hard: z.number() });

export const leetCodeProfileSchema = z.object({
  username: z.string().min(1),
  solved: countsSchema,
  total: countsSchema,
});

export const dailyQuestionResponseSchema = z.object({
  activeDailyCodingChallengeQuestion: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    // "Finish" once the signed-in user has solved today's question, otherwise "NotStart".
    userStatus: z.string().nullish(),
    question: z.object({
      questionId: z.string(),
      questionFrontendId: z.string(),
      title: z.string(),
      titleSlug: z.string().regex(/^[a-z0-9-]+$/),
      difficulty: z.string(),
    }),
  }),
  userStatus: z.object({ isSignedIn: z.boolean(), username: z.string().nullish() }).nullish(),
  // Null when signed out.
  streakCounter: z.object({ streakCount: z.number() }).nullish(),
});
