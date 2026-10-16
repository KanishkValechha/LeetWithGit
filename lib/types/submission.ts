import type { z } from 'zod';
import type { submissionSchema } from '../schemas/submission';

export type Submission = z.output<typeof submissionSchema>;
export type SubmissionInput = z.input<typeof submissionSchema>;

export interface QueuedSubmission {
  payload: Submission;
  submissionKey: string;
  attempts: number;
  nextAttemptAt: number;
}
