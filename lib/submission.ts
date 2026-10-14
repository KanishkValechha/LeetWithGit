import { z } from 'zod';

export const submissionSchema = z.object({
  submissionId: z.string().max(100).default(''),
  questionId: z.string().regex(/^\d+$/),
  problemTitle: z.string().trim().min(1).max(200),
  language: z.string().regex(/^[a-zA-Z0-9+#.-]{1,32}$/),
  difficulty: z.string().max(32).default('Unknown'),
  description: z.string().max(100_000).default(''),
  code: z.string().min(1).max(500_000),
});

export type Submission = z.output<typeof submissionSchema>;
export type SubmissionInput = z.input<typeof submissionSchema>;
