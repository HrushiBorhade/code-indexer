import { z } from 'zod';

// Treat empty strings as undefined (common with dotenv placeholders like QDRANT_URL=)
function emptyToUndefined(val: unknown) {
  return val === '' ? undefined : val;
}

const envSchema = z.object({
  EMBEDDING_PROVIDER: z.enum(['openai', 'voyage']).default('openai'),

  VOYAGE_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

  QDRANT_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  QDRANT_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const missing = result.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(
    `Missing or invalid environment variables:\n${missing}\nSet these in a .env file at the project root.`,
  );
}

const env = result.data;

export default env;
export type Env = z.infer<typeof envSchema>;
