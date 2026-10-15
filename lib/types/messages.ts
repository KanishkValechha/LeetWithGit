import type { z } from 'zod';
import type { runtimeMessageSchema } from '../schemas/messages';

export type RuntimeMessage = z.output<typeof runtimeMessageSchema>;
export type RuntimeMessageInput = z.input<typeof runtimeMessageSchema>;
