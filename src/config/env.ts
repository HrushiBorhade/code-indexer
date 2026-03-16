import { z } from 'zod';

// Treat empty strings as undefined (common with dotenv placeholders like QDRANT_URL=)
const emptyToUndefined = (val: unknown) => (val === '' ? undefined : val);

const envSchema = z.object({
  // Embedding provider: openai or voyage
  EMBEDDING_PROVIDER: z.enum(['openai', 'voyage']).default('openai'),

  // API keys — only the active provider's key is required (validated at runtime in embedder)
  VOYAGE_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

  // Qdrant (Phase 3)
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
  console.error(`[env] Missing or invalid environment variables:\n${missing}`);
  console.error('[env] Set these in a .env file at the project root.');
  process.exit(1);
}

const env = result.data;

export default env;
export type Env = z.infer<typeof envSchema>;
