import {
  pgTable,
  text,
  uuid,
  bigint,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// Better Auth tables (PROVISIONAL — validated with `pnpm dlx auth generate` in Step 5)

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true, mode: 'date' }),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true, mode: 'date' }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
    withTimezone: true,
    mode: 'date',
  }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
});

// Application tables

export const repos = pgTable(
  'repos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    githubId: bigint('github_id', { mode: 'bigint' }).notNull(),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    installationId: bigint('installation_id', { mode: 'bigint' }).notNull(),
    isPrivate: boolean('is_private').notNull().default(false),
    status: text('status').notNull().default('pending'),
    lastIndexedAt: timestamp('last_indexed_at', { withTimezone: true, mode: 'date' }),
    lastCommitSha: text('last_commit_sha'),
    indexError: text('index_error'),
    r2TarKey: text('r2_tar_key'),
    fileCount: integer('file_count').default(0),
    chunkCount: integer('chunk_count').default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('repos_user_github_idx').on(table.userId, table.githubId)],
);

export const fileHashes = pgTable(
  'file_hashes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    sha256: text('sha256').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('file_hashes_repo_path_idx').on(table.repoId, table.filePath)],
);

export const chunkCache = pgTable(
  'chunk_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    chunkHash: text('chunk_hash').notNull(),
    qdrantId: text('qdrant_id').notNull(),
    filePath: text('file_path').notNull(),
    lineStart: integer('line_start').notNull(),
    lineEnd: integer('line_end').notNull(),
  },
  (table) => [
    uniqueIndex('chunk_cache_repo_hash_idx').on(table.repoId, table.chunkHash),
    index('chunk_cache_repo_file_idx').on(table.repoId, table.filePath),
  ],
);

export const dirHashes = pgTable(
  'dir_hashes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    dirPath: text('dir_path').notNull(),
    merkleHash: text('merkle_hash').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('dir_hashes_repo_path_idx').on(table.repoId, table.dirPath)],
);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  repoId: uuid('repo_id')
    .notNull()
    .references(() => repos.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    toolCalls: jsonb('tool_calls'),
    toolResults: jsonb('tool_results'),
    tokensUsed: integer('tokens_used'),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('messages_convo_idx').on(table.conversationId, table.createdAt)],
);

export const indexJobs = pgTable('index_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  repoId: uuid('repo_id')
    .notNull()
    .references(() => repos.id, { onDelete: 'cascade' }),
  triggerRunId: text('trigger_run_id'),
  status: text('status').notNull().default('pending'),
  trigger: text('trigger').notNull(),
  commitSha: text('commit_sha'),
  queuedSha: text('queued_sha'),
  filesChanged: integer('files_changed'),
  chunksEmbedded: integer('chunks_embedded'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
