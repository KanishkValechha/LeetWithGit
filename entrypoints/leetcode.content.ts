import { defineContentScript } from 'wxt/utils/define-content-script';
import { z } from 'zod';
import { PAGE_PROFILE_MESSAGE, PAGE_SUBMISSION_MESSAGE } from '@/lib/constants';
import { leetCodeProfileSchema } from '@/lib/schemas/leetcode';
import { submissionSchema } from '@/lib/schemas/submission';
import { sendMessage } from '@/lib/api/messages';
import { leetCodeProfile } from '@/lib/api/storage';

const pageMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal(PAGE_SUBMISSION_MESSAGE), payload: submissionSchema }),
  z.object({ type: z.literal(PAGE_PROFILE_MESSAGE), payload: leetCodeProfileSchema.nullable() }),
]);

// Relays what the page-world scripts collect: submissions go to the background, profile stats to storage.
export default defineContentScript({
  matches: ['https://leetcode.com/*'],
  // Listen before the page-world scripts post anything.
  runAt: 'document_start',
  main(ctx) {
    ctx.addEventListener(window, 'message', (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const message = pageMessageSchema.safeParse(event.data);
      if (!message.success) return;

      if (message.data.type === PAGE_PROFILE_MESSAGE) {
        leetCodeProfile.setValue(message.data.payload).catch((error: unknown) => {
          console.error('LeetWithGit could not save your LeetCode stats:', error);
        });
        return;
      }
      sendMessage({ type: 'queue-submission', payload: message.data.payload }).catch((error: unknown) => {
        console.error('LeetWithGit could not queue this submission:', error);
      });
    });
  },
});
