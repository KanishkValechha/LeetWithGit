import { defineContentScript } from 'wxt/utils/define-content-script';
import { z } from 'zod';
import { sendMessage } from '@/lib/messages';
import { PAGE_SUBMISSION_MESSAGE } from '@/lib/page-message';
import { submissionSchema } from '@/lib/submission';

const pageMessageSchema = z.object({
  type: z.literal(PAGE_SUBMISSION_MESSAGE),
  payload: submissionSchema,
});

// Relays submissions captured in the page world to the background.
export default defineContentScript({
  matches: ['https://leetcode.com/*'],
  main(ctx) {
    ctx.addEventListener(window, 'message', (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const message = pageMessageSchema.safeParse(event.data);
      if (!message.success) return;

      sendMessage({ type: 'queue-submission', payload: message.data.payload }).catch((error: unknown) => {
        console.error('LeetWithGit could not queue this submission:', error);
      });
    });
  },
});
