import type { z } from 'zod';
import type { repositorySchema, viewerSchema } from '../schemas/github';

export type Viewer = z.infer<typeof viewerSchema>;
export type Repository = z.infer<typeof repositorySchema>;
