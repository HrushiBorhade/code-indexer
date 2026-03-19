import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Explicit path — Turborepo changes cwd to packages/db/ when running tasks
config({ path: new URL('../../.env', import.meta.url).pathname });

export default defineConfig({
  out: './drizzle',
  schema: './src/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
