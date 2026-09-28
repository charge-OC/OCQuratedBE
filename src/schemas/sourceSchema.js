import { z } from 'zod';

export const sourceCreateSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    type: z.enum(['csv', 'xml', 'api']),
    default_model_id: z.string().default('google/gemini-flash-1.5'),
    connection_config: z.record(z.any()).default({}),
    schedule_cron: z.string().nullable().optional(),
});

export const sourceUpdateSchema = sourceCreateSchema.partial();