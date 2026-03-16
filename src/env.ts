import { z } from 'zod';

const envSchema = z.object({
  VOYAGE_API_KEY: z.string().min(1, 'VOYAGE_API_KEY is required'),
  QDRANT_URL: z.string().url('QDRANT_URL must be a valid URL').optional(),
  QDRANT_KEY: z.string().min(1, 'QDRANT_KEY must not be empty').optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const env = envSchema.parse(process.env);

export default env;
export type Env = z.infer<typeof envSchema>;
