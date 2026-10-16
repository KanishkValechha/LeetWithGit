import { z } from 'zod';
import { submissionSchema } from './submission';

export const runtimeMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('queue-submission'), payload: submissionSchema }),
  z.object({ type: z.literal('process-queue') }),
  z.object({ type: z.literal('retry-now') }),
]);
