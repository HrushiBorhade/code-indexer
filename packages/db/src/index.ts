export * from './schema';
export * from './relations';
export { createDb, type Database } from './client';

// Re-export drizzle-orm operators so consumers use the same instance
// (pnpm strict isolation can resolve different copies otherwise)
export { eq, and, or, ne, gt, gte, lt, lte, desc, asc, sql } from 'drizzle-orm';
