import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';
import * as relations from './relations';

export function createDb(databaseUrl: string) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required — check your .env file');
  }
  const sql = neon(databaseUrl);
  return drizzle({ client: sql, schema: { ...schema, ...relations } });
}

export type Database = ReturnType<typeof createDb>;
