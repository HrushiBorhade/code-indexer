import { z } from 'zod';

const envSchema = z.object({
  VOYAGE_API_KEY: z.string().min(1, 'VOYAGE_API_KEY is required'),
  QDRANT_URL: z.string().url('QDRANT_URL must be a valid URL').optional(),
  QDRANT_KEY: z.string().min(1, 'QDRANT_KEY must not be empty').optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const missing = result.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`[env] Missing or invalid environment variables:\n${missing}`);
  console.error('[env] Set these in a .env file at the project root.');
  process.exit(1);
}

const env = result.data;

export default env;
export type Env = z.infer<typeof envSchema>;
