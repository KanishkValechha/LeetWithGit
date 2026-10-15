import { browser } from 'wxt/browser';
import { z } from 'zod';
import { submissionSchema } from './submission';

export const runtimeMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('queue-submission'), payload: submissionSchema }),
  z.object({ type: z.literal('process-queue') }),
  z.object({ type: z.literal('retry-now') }),
]);

export type RuntimeMessage = z.input<typeof runtimeMessageSchema>;

export async function sendMessage(message: RuntimeMessage): Promise<void> {
  await browser.runtime.sendMessage(message);
}
