import { createDb } from '@codeindexer/db/client';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const globalForDb = globalThis as unknown as {
  db: ReturnType<typeof createDb> | undefined;
};

export const db = globalForDb.db ?? createDb(process.env.DATABASE_URL);

if (process.env.NODE_ENV !== 'production') globalForDb.db = db;
