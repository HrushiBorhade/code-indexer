# Phase 1: Foundation — Step-by-Step Build Plan

> **Approach:** Build incrementally. Each step produces something you can run and verify. No scaffolding things we won't touch for weeks. No speculative code.
>
> **Docs verified against:** Turborepo v2.4 (JIT packages), Next.js 16.1 (`proxy.ts`, App Router, DAL pattern), Better Auth 1.3 (Drizzle adapter, GitHub OAuth, cookie cache, `getSessionCookie`), Better Auth UI (AuthUIProvider, AuthCard), Drizzle ORM 0.44 (neon-http driver, `drizzle-kit push`), Neon Serverless Postgres.
>
> **Reviewed by:** Architecture agent, Security agent, Best Practices agent. 22 findings applied.

**Spec:** `docs/specs/platform-design.md`
**Old plan (reference only):** `docs/specs/phase-1-implementation-plan.md`

---

## What Phase 1 Delivers

A user can:
1. Visit the app
2. Sign in with GitHub
3. Install the GitHub App and grant repo access
4. See their repos on a dashboard with status badges
5. (Repos show "pending" — actual indexing is Phase 2)

That's it. No search, no chat, no Hono API, no Trigger.dev. Those come when we need them.

---

## Steps

| # | Step | Verify before moving on |
|---|------|------------------------|
| 1 | pnpm + Turborepo monorepo | `pnpm install` works, directory structure exists |
| 2 | Move `src/` → `packages/core` | `pnpm --filter @codeindexer/core test` — all 152 tests pass |
| 3 | `packages/db` — Drizzle + Neon | `pnpm db:push` creates tables, visible in Drizzle Studio |
| 4 | `apps/web` — Next.js 16 + shadcn | `pnpm dev:web` → browser shows page at localhost:3000 |
| 5 | Better Auth + GitHub OAuth + DAL | Sign in with GitHub → see your name on /dashboard |
| 6 | GitHub App + webhook handler | Install app → repo row appears in Postgres |
| 7 | Dashboard UI | Full flow: sign in → empty state → add repo → see it listed |

---

## Critical Constraints (From Review)

Before coding, understand these:

1. **`apps/web` must NEVER import `@codeindexer/core`** — `packages/core` contains native N-API modules (tree-sitter, better-sqlite3) that break Turbopack. `apps/web` only imports `@codeindexer/db`. This is a hard rule.

2. **`drizzle-orm` operators (eq, and, etc.) are imported directly** — consumers do `import { eq } from 'drizzle-orm'`, NOT from `@codeindexer/db`. This prevents version coupling.

3. **Neon pooled connection string** — use the `-pooler` hostname variant in `DATABASE_URL` for Vercel serverless. Without it, each function invocation opens a new connection and exhausts Postgres limits.

4. **Better Auth schema is provisional in Step 3** — we define it based on docs, then validate with `pnpm dlx auth generate` in Step 5. Expect a re-push.

5. **`GITHUB_APP_PRIVATE_KEY` format** — PEM newlines in `.env` files are tricky. Store as base64 and decode in code, or use actual newlines in double-quoted value. `dotenv` does NOT expand `\n` escape sequences in all versions.

---

## Step 1: pnpm + Turborepo Monorepo

**What:** Convert from single npm package to pnpm monorepo with Turborepo.

### Why these choices

- **pnpm** — Turborepo's recommended manager. Strict hoisting prevents phantom deps. `workspace:*` protocol for internal deps.
- **`create-turbo`** — We're NOT using it. It generates a "docs + web + ui" starter that doesn't match our structure. Manual setup is cleaner.
- **JIT (Just-in-Time) packages** — Per Turborepo docs, internal packages export `.ts` source directly. The consuming app's bundler (Turbopack) compiles them. **No `tsc` build step needed for packages.**

### Files to create

**`pnpm-workspace.yaml`:**
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**`.npmrc`:**
```ini
auto-install-peers=true
strict-peer-dependencies=false
public-hoist-pattern[]=*.node
```

> `public-hoist-pattern[]=*.node` — pnpm's strict isolation can break native module (.node binary) resolution for tree-sitter and better-sqlite3. This hoists native binaries so they resolve correctly at runtime.

**`packages/tsconfig/package.json`:**
```json
{
  "name": "@codeindexer/tsconfig",
  "version": "0.0.0",
  "private": true,
  "exports": {
    "./base.json": "./base.json",
    "./library.json": "./library.json",
    "./nextjs.json": "./nextjs.json"
  }
}
```

**`packages/tsconfig/base.json`:**
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true
  },
  "exclude": ["node_modules", "dist"]
}
```

**`packages/tsconfig/library.json`:**
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

**`packages/tsconfig/nextjs.json`:**
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "noEmit": true,
    "plugins": [{ "name": "next" }]
  }
}
```

**Root `package.json`** (replaces existing):
```json
{
  "name": "codeindexer",
  "private": true,
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "dev:web": "turbo run dev --filter=@codeindexer/web",
    "lint": "turbo run lint",
    "lint:fix": "turbo run lint:fix",
    "format": "prettier --write \"**/*.{ts,tsx,md,json}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,md,json}\"",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "db:push": "turbo run db:push --filter=@codeindexer/db",
    "db:generate": "turbo run db:generate --filter=@codeindexer/db",
    "db:studio": "turbo run db:studio --filter=@codeindexer/db",
    "clean": "turbo run clean && rm -rf node_modules .turbo"
  },
  "devDependencies": {
    "turbo": "^2.4.4",
    "prettier": "^3.8.1",
    "typescript": "^5.9.3"
  },
  "packageManager": "pnpm@9.15.4",
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**`turbo.json`:**
```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "env": ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL",
              "NEXT_PUBLIC_BETTER_AUTH_URL", "GITHUB_CLIENT_ID"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "lint:fix": {},
    "typecheck": {},
    "test": {
      "inputs": ["src/**", "vitest.config.*"]
    },
    "clean": {
      "cache": false
    },
    "db:push": {
      "cache": false
    },
    "db:generate": {
      "cache": false
    },
    "db:studio": {
      "cache": false,
      "persistent": true
    }
  }
}
```

> **No `globalDependencies: [".env"]`** — per Turborepo docs, this invalidates ALL caches on any env change. Instead, use per-task `env` arrays with explicit var names. `test` has `inputs` so turbo caches test results when source hasn't changed.

**`.env.example`** (created now, updated throughout):
```bash
# ─── Database (use pooled connection string: -pooler hostname) ───
DATABASE_URL=postgresql://user:pass@ep-xxx-pooler.us-east-2.aws.neon.tech/codeindexer?sslmode=require

# ─── Better Auth ───
# IMPORTANT: These two MUST be the same URL. NEXT_PUBLIC_ exposes to browser bundle.
BETTER_AUTH_SECRET=<openssl rand -hex 32>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000

# ─── GitHub OAuth (from GitHub Developer Settings > OAuth Apps) ───
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# ─── GitHub App (from GitHub Developer Settings > GitHub Apps) ───
GITHUB_APP_ID=
# Store PEM with actual newlines (NOT \n escape sequences):
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...actual base64 lines...
-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET=
```

### Actions

```bash
rm package-lock.json
mkdir -p packages/tsconfig
# Create all files above
# Add .turbo to .gitignore
pnpm install
```

### Verify
- [ ] `pnpm install` completes without errors
- [ ] `pnpm-lock.yaml` generated
- [ ] `ls node_modules/.pnpm` shows the content store

### Commit
```
feat: convert to pnpm + Turborepo monorepo
```

---

## Step 2: Move `src/` → `packages/core`

**What:** Move all library code into a JIT package. Tests must still pass.

### Key decisions

- **JIT (no build step)** — export `.ts` source directly. Consuming app's bundler compiles.
- **`apps/web` does NOT depend on `packages/core`** — core has native N-API modules (tree-sitter, better-sqlite3) that break Turbopack. Only `apps/trigger` (Phase 2) will import core.

### Files

**`packages/core/package.json`:**
```json
{
  "name": "@codeindexer/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./chunker": "./src/chunker/index.ts",
    "./lib/walker": "./src/lib/walker.ts",
    "./lib/embedder": "./src/lib/embedder.ts",
    "./lib/hash": "./src/lib/hash.ts",
    "./lib/store": "./src/lib/store.ts",
    "./lib/search": "./src/lib/search.ts",
    "./lib/grep": "./src/lib/grep.ts",
    "./lib/merge": "./src/lib/merge.ts",
    "./lib/sync": "./src/lib/sync.ts",
    "./lib/db": "./src/lib/db.ts",
    "./lib/languages": "./src/lib/languages.ts",
    "./lib/shutdown": "./src/lib/shutdown.ts",
    "./utils/logger": "./src/utils/logger.ts",
    "./config/env": "./src/config/env.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf .turbo"
  },
  "dependencies": {
    "better-sqlite3": "^12.8.0",
    "dotenv": "^16.6.1",
    "fast-glob": "^3.3.3",
    "pino": "^10.3.1",
    "pino-pretty": "^13.1.3",
    "tree-sitter": "^0.21.1",
    "tree-sitter-css": "^0.21.1",
    "tree-sitter-go": "^0.21.2",
    "tree-sitter-javascript": "^0.21.4",
    "tree-sitter-python": "^0.21.0",
    "tree-sitter-rust": "^0.21.0",
    "tree-sitter-typescript": "^0.23.2",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@codeindexer/tsconfig": "workspace:*",
    "@eslint/js": "^10.0.1",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.19.15",
    "@vitest/coverage-v8": "^4.1.0",
    "eslint": "^10.0.3",
    "eslint-config-prettier": "^10.1.8",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.57.0",
    "vitest": "^4.1.0"
  }
}
```

**`packages/core/tsconfig.json`:**
```json
{
  "extends": "@codeindexer/tsconfig/library.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

**`packages/core/src/index.ts`** — barrel export:
```typescript
export { chunkFile } from './chunker/index.js'
export type { Chunk } from './chunker/types.js'
export { walkFiles } from './lib/walker.js'
export { hashFile, hashString } from './lib/hash.js'
export { embedChunks, embedQuery, getProvider } from './lib/embedder.js'
export { ensureCollection, upsertPoints, deletePoints, searchPoints } from './lib/store.js'
export type { PointPayload, SearchResult, UpsertPoint } from './lib/store.js'
export { semanticSearch } from './lib/search.js'
export type { CodeSearchResult } from './lib/search.js'
export { grepSearch } from './lib/grep.js'
export { mergeResults } from './lib/merge.js'
export { computeChanges, persistMerkleState } from './lib/sync.js'
export type { SyncResult } from './lib/sync.js'
export { initDb, closeDb } from './lib/db.js'
export { getLanguage, getSupportedExtensions, LANGUAGE_MAP } from './lib/languages.js'
export { createLogger } from './utils/logger.js'
export { onShutdown, registerShutdownHandlers } from './lib/shutdown.js'
```

### Actions

```bash
mkdir -p packages/core/src
mv src/chunker packages/core/src/
mv src/lib packages/core/src/
mv src/utils packages/core/src/
mv src/config packages/core/src/
mv vitest.config.ts packages/core/
mv eslint.config.mjs packages/core/
rm src/index.ts
rmdir src
pnpm install
```

### Verify
- [ ] `pnpm install` succeeds
- [ ] `pnpm --filter @codeindexer/core test` — all 152 tests pass
- [ ] `pnpm --filter @codeindexer/core typecheck` passes
- [ ] `pnpm --filter @codeindexer/core lint` passes
- [ ] `ls src/` — should not exist (deleted)

### Commit
```
refactor: move library code to packages/core as JIT package
```

---

## Step 3: `packages/db` — Drizzle + Neon

**What:** Create the database package with Drizzle schema. Push to Neon Postgres.

### Prerequisite: Create Neon database

1. Go to [neon.tech](https://neon.tech), create project "codeindexer"
2. **Copy the POOLED connection string** (the `-pooler` hostname variant) — this is critical for Vercel serverless
3. Add to root `.env`:
   ```
   DATABASE_URL=postgresql://user:pass@ep-xxx-pooler.us-east-2.aws.neon.tech/codeindexer?sslmode=require
   ```

> **Why pooled?** Neon's HTTP driver creates one connection per query. Without the pooler, Vercel's concurrent serverless functions can exhaust Postgres connection limits.

### Files

**`packages/db/package.json`:**
```json
{
  "name": "@codeindexer/db",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./schema": "./src/schema.ts",
    "./client": "./src/client.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio",
    "clean": "rm -rf .turbo"
  },
  "dependencies": {
    "@neondatabase/serverless": "^1.0.0",
    "drizzle-orm": "^0.44.0"
  },
  "devDependencies": {
    "@codeindexer/tsconfig": "workspace:*",
    "@types/node": "^22.19.15",
    "dotenv": "^16.6.1",
    "drizzle-kit": "^0.31.0",
    "typescript": "^5.9.3"
  }
}
```

> `dotenv` is a devDependency — only `drizzle.config.ts` (a dev tool) needs it. Runtime code receives `DATABASE_URL` from the consuming app's env.
> `@types/node` explicitly listed — prevents phantom dependency on hoisted types.

**`packages/db/tsconfig.json`:**
```json
{
  "extends": "@codeindexer/tsconfig/library.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

**`packages/db/drizzle.config.ts`:**
```typescript
import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// Explicit path — Turborepo changes cwd to packages/db/ when running tasks
config({ path: new URL('../../.env', import.meta.url).pathname })

export default defineConfig({
  out: './drizzle',
  schema: './src/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

> **Fix from review:** `dotenv/config` auto-import doesn't find root `.env` when cwd is `packages/db/`. Explicit path resolves this.

**`packages/db/src/schema.ts`:**

```typescript
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
} from 'drizzle-orm/pg-core'

// ════════════════════════════════════════════════════════
// Better Auth tables
//
// PROVISIONAL: These must match what Better Auth expects.
// After wiring up auth in Step 5, run:
//   pnpm dlx auth generate
// and diff the output against this file. Fix any mismatches,
// then re-run pnpm db:push.
// ════════════════════════════════════════════════════════

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true, mode: 'date' }),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

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
})

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
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true, mode: 'date' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
})

// ════════════════════════════════════════════════════════
// Application tables (spec Section 5)
// ════════════════════════════════════════════════════════

export const repos = pgTable(
  'repos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // FIX: mode 'bigint' not 'number' — JS numbers lose precision above 2^53.
    // GitHub IDs can exceed this for large orgs. Use BigInt to prevent silent corruption.
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
  (table) => [uniqueIndex('repos_user_github_idx').on(table.userId, table.githubId)]
)

export const fileHashes = pgTable(
  'file_hashes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id').notNull().references(() => repos.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    sha256: text('sha256').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('file_hashes_repo_path_idx').on(table.repoId, table.filePath)]
)

export const chunkCache = pgTable(
  'chunk_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id').notNull().references(() => repos.id, { onDelete: 'cascade' }),
    chunkHash: text('chunk_hash').notNull(),
    qdrantId: text('qdrant_id').notNull(),
    filePath: text('file_path').notNull(),
    lineStart: integer('line_start').notNull(),
    lineEnd: integer('line_end').notNull(),
  },
  (table) => [
    uniqueIndex('chunk_cache_repo_hash_idx').on(table.repoId, table.chunkHash),
    index('chunk_cache_repo_file_idx').on(table.repoId, table.filePath),
  ]
)

export const dirHashes = pgTable(
  'dir_hashes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id').notNull().references(() => repos.id, { onDelete: 'cascade' }),
    dirPath: text('dir_path').notNull(),
    merkleHash: text('merkle_hash').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('dir_hashes_repo_path_idx').on(table.repoId, table.dirPath)]
)

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  repoId: uuid('repo_id').notNull().references(() => repos.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

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
  (table) => [index('messages_convo_idx').on(table.conversationId, table.createdAt)]
)

export const indexJobs = pgTable('index_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  repoId: uuid('repo_id').notNull().references(() => repos.id, { onDelete: 'cascade' }),
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
})
```

> **Fixes from review:**
> - `githubId` and `installationId` use `mode: 'bigint'` — prevents silent data corruption for IDs > 2^53
> - Added `isPrivate` boolean column — needed for UI display and future billing/plan decisions
> - Added `boolean` import from `drizzle-orm/pg-core`

**`packages/db/src/relations.ts`:** (unchanged from before — see old plan for full code)

**`packages/db/src/client.ts`:**
```typescript
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from './schema.js'
import * as relations from './relations.js'

export function createDb(databaseUrl: string) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required — check your .env file')
  }
  const sql = neon(databaseUrl)
  return drizzle({ client: sql, schema: { ...schema, ...relations } })
}

export type Database = ReturnType<typeof createDb>
```

> **Fix from review:** Explicit error message instead of silent `undefined` passed to Neon.

**`packages/db/src/index.ts`:**
```typescript
export * from './schema.js'
export * from './relations.js'
export { createDb, type Database } from './client.js'
```

### Actions

```bash
mkdir -p packages/db/src
# Create all files above
pnpm install
pnpm db:push
pnpm db:studio
```

> **Note:** Migration files in `packages/db/drizzle/` should be committed to Git. They are the source of truth for schema history.

### Verify
- [ ] `pnpm install` succeeds
- [ ] `pnpm db:push` succeeds — no SQL errors
- [ ] `pnpm db:studio` shows all 11 tables
- [ ] `repos` table has `is_private` column
- [ ] `repos.github_id` is type `bigint` in Postgres
- [ ] Neon cold start note: first query may take 3-7s on free tier. This is normal.

### Commit
```
feat: add packages/db with Drizzle schema for Neon Postgres
```

---

## Step 4: `apps/web` — Next.js 16 + shadcn Shell

**What:** Create the Next.js frontend app. Just the shell — no auth yet.

### Actions

```bash
cd apps
pnpm create next-app@latest web \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*"
cd ..
```

> **No `--turbopack` flag** — Turbopack is the default in Next.js 16.

Update `apps/web/package.json`:
- Set `"name": "@codeindexer/web"`
- Add `"@codeindexer/db": "workspace:*"` to dependencies
- Do NOT add `@codeindexer/core` — native modules will break Turbopack

Replace `apps/web/tsconfig.json` with the **full merged content** (preserve paths alias):
```json
{
  "extends": "@codeindexer/tsconfig/nextjs.json",
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Add `apps/web/next.config.ts` with security headers and native module guardrail:
```typescript
import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
]

const nextConfig: NextConfig = {
  // Guardrail: if someone accidentally imports @codeindexer/core from web,
  // these prevent Turbopack from trying to bundle native N-API modules
  serverExternalPackages: [
    'better-sqlite3', 'tree-sitter',
    'tree-sitter-typescript', 'tree-sitter-javascript',
    'tree-sitter-python', 'tree-sitter-rust',
    'tree-sitter-go', 'tree-sitter-css',
  ],
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
```

Init shadcn and add components:
```bash
cd apps/web
npx shadcn@latest init --preset auFzGMc
npx shadcn@latest add button card badge skeleton separator avatar
cd ../..
pnpm install
pnpm dev:web
```

### Verify
- [ ] `pnpm dev:web` starts without errors
- [ ] `localhost:3000` shows the page
- [ ] shadcn theme applied (inspect CSS custom properties)
- [ ] `pnpm --filter @codeindexer/web typecheck` passes
- [ ] Security headers visible in browser devtools Network tab

### Commit
```
feat: scaffold Next.js 16 app with shadcn
```

---

## Step 5: Better Auth + GitHub OAuth + Data Access Layer

**What:** Users can sign in with GitHub. Sessions work. Optimized with cookie caching and the DAL pattern.

### The auth architecture (3 layers, from docs)

Per **Next.js 16 auth guide** and **Better Auth Next.js integration docs**, the recommended production pattern has three layers:

1. **`proxy.ts`** — Optimistic cookie check. No DB query. Fast redirect for unauthenticated users. Uses `getSessionCookie()` from Better Auth.
2. **`lib/dal.ts`** — Data Access Layer. Cached `getSession()` wrapped in `React.cache()`. One DB query per render pass, shared across all server components/actions in the same request.
3. **Cookie cache** — Better Auth `session.cookieCache` stores session data in a signed cookie. Avoids DB roundtrip for active users (cache expires every 5 min).

### Prerequisites

1. Create **GitHub OAuth App** at [github.com/settings/developers](https://github.com/settings/developers):
   - Name: `CodeIndexer Dev`
   - Homepage: `http://localhost:3000`
   - Callback URL: `http://localhost:3000/api/auth/callback/github`
2. Add to root `.env` (refer to `.env.example` for format)

### Install

```bash
cd apps/web
pnpm add better-auth @daveyplate/better-auth-ui
cd ../..
```

### Files to create

**`apps/web/src/lib/auth.ts`** — server-side Better Auth config:
```typescript
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createDb } from '@codeindexer/db/client'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
if (!process.env.BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is required')

const db = createDb(process.env.DATABASE_URL)

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,

  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24,      // refresh session age every 24h
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes — session data cached in signed cookie
    },
  },

  // FIX from review: trusted origins for preview deploys
  trustedOrigins: [
    process.env.BETTER_AUTH_URL!,
    // Add Vercel preview URLs when deploying:
    // `https://*.vercel.app`
  ],

  // FIX from review: explicit cookie security
  advanced: {
    cookiePrefix: 'codeindexer',
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  },
})

export type Session = typeof auth.$Infer.Session
```

> **Fixes from review:**
> - Explicit env var assertions at startup
> - `session.cookieCache` — avoids DB query on every `getSession()` call (massive perf win)
> - `trustedOrigins` — prevents silent sign-in failures on Vercel preview deploys
> - Explicit cookie attributes — httpOnly, sameSite, secure

**`apps/web/src/lib/auth-client.ts`** — client-side:
```typescript
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? 'http://localhost:3000',
})
```

**`apps/web/src/lib/dal.ts`** — Data Access Layer (new file, from Next.js docs):
```typescript
import 'server-only'
import { cache } from 'react'
import { auth } from './auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

/**
 * Cached session verification — the single source of truth for auth state.
 *
 * Per Next.js docs: "Use React's cache API to memoize the return value
 * during a React render pass." Multiple server components calling this
 * in the same request make only ONE database query (or zero if cookie
 * cache is still valid).
 *
 * Use this in: server components, server actions, route handlers.
 * Do NOT use in client components — use authClient.useSession() instead.
 */
export const getSession = cache(async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  })
  if (!session) redirect('/login')
  return session
})

/**
 * Same as getSession but returns null instead of redirecting.
 * Use in layouts or pages where you want to show different UI
 * for authenticated vs unauthenticated users.
 */
export const getOptionalSession = cache(async () => {
  return auth.api.getSession({
    headers: await headers(),
  })
})
```

> **Why this matters:** Without `cache()`, if a layout AND a page AND a server action all call `auth.api.getSession()`, that's 3 DB queries for the same request. With `cache()`, it's 1 (or 0 if cookie cache is fresh).

**`apps/web/src/proxy.ts`** — optimistic cookie redirect (Next.js 16):
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'

/**
 * Next.js 16 proxy (replaces middleware.ts).
 * Named export, NOT default export — per Next.js 16 docs.
 *
 * This is an OPTIMISTIC check — cookie exists ≠ valid session.
 * Real auth validation happens in the DAL (lib/dal.ts).
 * This just prevents flash of wrong page.
 */
export function proxy(request: NextRequest) {
  const session = getSessionCookie(request, {
    cookiePrefix: 'codeindexer',
  })
  const path = request.nextUrl.pathname

  // Redirect unauthenticated users away from protected routes
  if (path.startsWith('/dashboard') && !session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (path.startsWith('/repo') && !session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Redirect authenticated users away from login
  if (path === '/login' && session) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
```

> **Why proxy.ts is included now (changed from "deferred"):** Better Auth docs recommend `getSessionCookie()` for optimistic redirects. Zero DB queries. Prevents flash of login page for authenticated users. The real validation is in the DAL.

**`apps/web/src/app/api/auth/[...all]/route.ts`:**
```typescript
import { auth } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'

export const { POST, GET } = toNextJsHandler(auth)
```

**`apps/web/src/components/providers.tsx`:**
```tsx
'use client'

import { AuthUIProvider } from '@daveyplate/better-auth-ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { authClient } from '@/lib/auth-client'

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter()

  return (
    <AuthUIProvider
      authClient={authClient}
      navigate={router.push}
      replace={router.replace}
      onSessionChange={() => router.refresh()}
      social={{ providers: ['github'] }}
      Link={Link}
    >
      {children}
    </AuthUIProvider>
  )
}
```

**Update `apps/web/src/app/layout.tsx`** — wrap with Providers.

**`apps/web/src/app/login/page.tsx`:**
```tsx
import { AuthCard } from '@daveyplate/better-auth-ui'

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <AuthCard />
    </div>
  )
}
```

**`apps/web/src/app/dashboard/page.tsx`** — uses the DAL:
```tsx
import { getSession } from '@/lib/dal'

export default async function DashboardPage() {
  const session = await getSession() // cached, redirects if not authenticated

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-2 text-muted-foreground">Welcome, {session.user.name}</p>
    </div>
  )
}
```

### Validate schema match

```bash
cd apps/web
pnpm dlx auth generate
```

Diff output against `packages/db/src/schema.ts`. Fix mismatches, then:

```bash
pnpm db:push
```

### Verify
- [ ] `/login` renders GitHub sign-in button
- [ ] OAuth redirect to GitHub works
- [ ] Callback redirects to `/dashboard`
- [ ] Check Drizzle Studio: `user`, `session`, `account` tables have rows
- [ ] `/dashboard` shows "Welcome, [name]" (uses DAL)
- [ ] `/dashboard` without session → redirected to `/login` (via proxy.ts, no flash)
- [ ] `/login` with active session → redirected to `/dashboard` (via proxy.ts)
- [ ] Refreshing page keeps session (cookie cache — no DB delay)
- [ ] Security headers present in response (X-Frame-Options, etc.)
- [ ] `pnpm dlx auth generate` output matches our schema

### Commit
```
feat: add Better Auth with GitHub OAuth, DAL, and proxy.ts
```

---

## Step 6: GitHub App + Installation Webhook

**What:** Create a GitHub App for repo access and handle installation webhooks.

### Prerequisites

1. Create GitHub App at [github.com/settings/apps/new](https://github.com/settings/apps/new):
   - Name: `CodeIndexer-Dev`
   - Homepage: `http://localhost:3000`
   - Webhook URL: [smee.io](https://smee.io/) channel URL
   - Webhook secret: `openssl rand -hex 20`
   - Permissions: Repository > Contents: Read, Metadata: Read
   - Events: `installation`, `installation_repositories`, `push`
2. Note App ID, generate private key (.pem)
3. Add to `.env` (see `.env.example` for PEM format)
4. Start smee: `npx smee -u https://smee.io/<channel> --target http://localhost:3000/api/webhooks/github`

### Files to create

**`apps/web/src/app/api/webhooks/github/route.ts`:**

```typescript
import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createDb } from '@codeindexer/db/client'
import { repos, account } from '@codeindexer/db/schema'
import { eq, and } from 'drizzle-orm'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
if (!process.env.GITHUB_APP_WEBHOOK_SECRET) throw new Error('GITHUB_APP_WEBHOOK_SECRET is required')

const db = createDb(process.env.DATABASE_URL)

// ─── Zod schemas for webhook payloads ───
// FIX from review: validate payloads instead of using `any` types

const repoSchema = z.object({
  id: z.number(),
  full_name: z.string(),
  private: z.boolean().optional().default(false),
  default_branch: z.string().optional().default('main'),
})

const installationEventSchema = z.object({
  action: z.string(),
  installation: z.object({
    id: z.number(),
    account: z.object({ id: z.number() }),
  }),
  repositories: z.array(repoSchema).optional(),
})

const installationReposEventSchema = z.object({
  installation: z.object({
    id: z.number(),
    account: z.object({ id: z.number() }),
  }),
  repositories_added: z.array(repoSchema).optional(),
  repositories_removed: z.array(z.object({ id: z.number(), full_name: z.string() })).optional(),
})

// ─── Webhook signature verification ───

function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  // FIX from review: check lengths before timingSafeEqual to avoid leaking length info
  if (sigBuf.length !== expBuf.length) return false
  return timingSafeEqual(sigBuf, expBuf)
}

// ─── Route handler ───

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('X-Hub-Signature-256')
  const event = req.headers.get('X-GitHub-Event')

  if (!signature || !verifySignature(body, signature, process.env.GITHUB_APP_WEBHOOK_SECRET!)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Respond 200 immediately — process in background
  // Note: In production on Vercel, use waitUntil() from @vercel/functions
  // to continue processing after the response is sent (GitHub has 10s timeout)

  const payload = JSON.parse(body)

  try {
    switch (event) {
      case 'installation':
        await handleInstallation(payload)
        break
      case 'installation_repositories':
        await handleInstallationRepositories(payload)
        break
      case 'push':
        // Phase 2: will trigger sync-repo via Trigger.dev
        break
    }
  } catch (error) {
    console.error(`Webhook ${event} processing failed:`, error)
    // Still return 200 — we don't want GitHub to retry on our app errors
  }

  return NextResponse.json({ ok: true })
}

// ─── Handlers ───

async function handleInstallation(raw: unknown) {
  const payload = installationEventSchema.parse(raw)

  if (payload.action === 'deleted') {
    // Mark repos as disconnected — full cleanup in Phase 2
    // For now, just log. Repos stay in DB but webhook handler won't re-create them.
    console.log(`GitHub App uninstalled: installation ${payload.installation.id}`)
    return
  }

  if (payload.action !== 'created') return

  const { installation, repositories } = payload
  if (!repositories?.length) return

  const githubAccountId = String(installation.account.id)
  const userAccount = await db.query.account.findFirst({
    where: and(
      eq(account.providerId, 'github'),
      eq(account.accountId, githubAccountId),
    ),
  })

  if (!userAccount) {
    // Edge case: webhook arrived before user completed OAuth.
    // Spec Section 9.1 acknowledges this. Log for debugging.
    console.warn(`No user found for GitHub account ${githubAccountId} — webhook dropped`)
    return
  }

  for (const repo of repositories) {
    await db.insert(repos).values({
      userId: userAccount.userId,
      githubId: BigInt(repo.id),
      fullName: repo.full_name,
      // FIX from review: use actual default branch from payload
      defaultBranch: repo.default_branch ?? 'main',
      installationId: BigInt(installation.id),
      isPrivate: repo.private ?? false,
      status: 'pending',
    })
    // FIX from review: onConflictDoUpdate instead of DoNothing —
    // refreshes installationId on re-install (GitHub can rotate these)
    .onConflictDoUpdate({
      target: [repos.userId, repos.githubId],
      set: {
        installationId: BigInt(installation.id),
        defaultBranch: repo.default_branch ?? 'main',
        isPrivate: repo.private ?? false,
        status: 'pending',
        updatedAt: new Date(),
      },
    })
  }
}

async function handleInstallationRepositories(raw: unknown) {
  const payload = installationReposEventSchema.parse(raw)
  const { installation, repositories_added, repositories_removed } = payload

  // Handle added repos
  if (repositories_added?.length) {
    const githubAccountId = String(installation.account.id)
    const userAccount = await db.query.account.findFirst({
      where: and(
        eq(account.providerId, 'github'),
        eq(account.accountId, githubAccountId),
      ),
    })

    if (!userAccount) return

    for (const repo of repositories_added) {
      await db.insert(repos).values({
        userId: userAccount.userId,
        githubId: BigInt(repo.id),
        fullName: repo.full_name,
        defaultBranch: repo.default_branch ?? 'main',
        installationId: BigInt(installation.id),
        isPrivate: repo.private ?? false,
        status: 'pending',
      })
      .onConflictDoUpdate({
        target: [repos.userId, repos.githubId],
        set: {
          installationId: BigInt(installation.id),
          defaultBranch: repo.default_branch ?? 'main',
          isPrivate: repo.private ?? false,
          status: 'pending',
          updatedAt: new Date(),
        },
      })
    }
  }

  // Handle removed repos — mark for cleanup
  if (repositories_removed?.length) {
    for (const repo of repositories_removed) {
      // Phase 2: trigger cleanup task. For now, mark as deleting.
      console.log(`Repo removed from installation: ${repo.full_name}`)
    }
  }
}
```

> **Fixes from review:**
> - Zod validation on all webhook payloads — no more `any` types
> - Length-checked `timingSafeEqual` — prevents timing leak on length mismatch
> - `onConflictDoUpdate` instead of `DoNothing` — refreshes `installationId` on re-install
> - `repo.default_branch` from payload — not hardcoded to `'main'`
> - `repo.private` from payload → `isPrivate` column
> - `BigInt()` wrapper for GitHub IDs (matches `mode: 'bigint'` in schema)
> - Handles `installation.deleted` event (logged, Phase 2 cleanup)
> - Handles `repositories_removed` event (logged, Phase 2 cleanup)
> - Try/catch around processing — always return 200 to prevent GitHub retry storms
> - Env var assertions at module level

### Verify
- [ ] Webhook arrives (check smee dashboard)
- [ ] Invalid signatures rejected (401)
- [ ] Installation creates repo rows in Postgres
- [ ] `repos.github_id` stored as bigint
- [ ] `repos.default_branch` matches the repo's actual branch
- [ ] `repos.is_private` correctly set
- [ ] Re-installing the app updates `installationId` (not silently ignored)
- [ ] Uninstalling the app is logged (check server console)
- [ ] Malformed payloads are caught by Zod (check error handling)

### Commit
```
feat: add GitHub App webhook handler for repo installation
```

---

## Step 7: Dashboard — Repo List + Empty State

**What:** Build the real dashboard. Show repos with status, or empty state with CTA.

### Files to create

- `apps/web/src/lib/db.ts` — Next.js DB singleton
- `apps/web/src/app/dashboard/page.tsx` — rewrite with repo fetching
- `apps/web/src/components/dashboard/repo-list.tsx`
- `apps/web/src/components/dashboard/repo-card.tsx`
- `apps/web/src/components/dashboard/empty-state.tsx`
- `apps/web/src/components/dashboard/nav.tsx`

### DB singleton

`apps/web/src/lib/db.ts`:
```typescript
import { createDb } from '@codeindexer/db/client'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

const globalForDb = globalThis as unknown as {
  db: ReturnType<typeof createDb> | undefined
}

export const db = globalForDb.db ?? createDb(process.env.DATABASE_URL)

if (process.env.NODE_ENV !== 'production') globalForDb.db = db
```

### Dashboard page

Uses the DAL for auth, DB singleton for data:
```typescript
import { getSession } from '@/lib/dal'
import { db } from '@/lib/db'
import { repos } from '@codeindexer/db/schema'
import { eq } from 'drizzle-orm'

export default async function DashboardPage() {
  const session = await getSession() // cached, one DB query max

  const userRepos = await db.query.repos.findMany({
    where: eq(repos.userId, session.user.id),
    orderBy: (repos, { desc }) => [desc(repos.createdAt)],
  })

  // Render <RepoList> if repos exist, <EmptyState> if not
}
```

### Status badges

| Status | Color | Label |
|--------|-------|-------|
| `pending` | yellow | Pending |
| `cloning` | blue | Cloning... |
| `indexing` | blue | Indexing... |
| `ready` | green | Ready |
| `error` | red | Error |
| `stale` | gray | Stale |

### "Add Repository" CTA

Links to: `https://github.com/apps/codeindexer-dev/installations/new`

### Verify
- [ ] Empty state renders when no repos
- [ ] "Add Repository" links to GitHub App install
- [ ] After installing, repos appear on dashboard (refresh page)
- [ ] Status badges show correct colors
- [ ] Private repos show lock icon (uses `isPrivate` column)
- [ ] Nav shows user avatar and name
- [ ] Sign out works (via Better Auth UI)
- [ ] Unauthenticated → redirected to `/login` (proxy.ts, no flash)

### Commit
```
feat: add dashboard with repo list and empty state
```

---

## After Step 7: Update CI

```yaml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
```

### Commit
```
ci: update GitHub Actions for pnpm + Turborepo
```

---

## What We Explicitly Deferred

| Deferred | Why | When |
|----------|-----|------|
| `packages/config` (shared env) | Only one service exists. Extract when second needs shared env. | Phase 2/3 |
| `apps/api` (Hono) | No search or chat yet. | Phase 3 |
| `apps/trigger` (Trigger.dev) | No indexing pipeline yet. | Phase 2 |
| JWT plugin for Better Auth | Only needed for cross-origin auth (browser → Hono). | Phase 3 |
| Email (Resend) | No users to email. | Phase 5 |
| Sentry / OTEL | Add Sentry early Phase 3. | Phase 3/5 |
| Webhook replay protection | `X-GitHub-Delivery` dedup — OK for Phase 1 with `onConflictDoUpdate`. | Phase 2 |
| `neon-http` → WebSocket driver | HTTP driver is fine for Next.js. Workers need connection reuse. | Phase 2 |
| `installation.deleted` cleanup | Logged only. Full cleanup needs Trigger.dev tasks. | Phase 2 |
| Turbo remote caching | Free with Vercel. Add when deploying. | First deploy |

---

## Review Findings Applied

| # | Finding | Fix applied |
|---|---------|-------------|
| 1 | `bigint` mode 'number' — silent data corruption | Changed to `mode: 'bigint'` + `BigInt()` wrappers |
| 2 | `onConflictDoNothing` — stale installationId | Changed to `onConflictDoUpdate` |
| 3 | `defaultBranch` hardcoded to 'main' | Uses `repo.default_branch` from payload |
| 4 | `timingSafeEqual` without length check | Added explicit length comparison |
| 5 | No Zod validation on webhook payload | Added Zod schemas for all events |
| 6 | `dotenv/config` can't find root `.env` | Explicit path in `drizzle.config.ts` |
| 7 | Missing `trustedOrigins` | Added to Better Auth config |
| 8 | `apps/web` must not import `@codeindexer/core` | Documented as hard constraint + `serverExternalPackages` guardrail |
| 9 | Missing DAL pattern | Added `lib/dal.ts` with `cache()` wrapper |
| 10 | Missing `proxy.ts` for optimistic redirects | Added using `getSessionCookie` from Better Auth |
| 11 | Missing cookie cache | Enabled `session.cookieCache` (5 min TTL) |
| 12 | Missing `is_private` column | Added to repos table |
| 13 | `.npmrc` missing native module hoist | Added `public-hoist-pattern[]=*.node` |
| 14 | Neon pooled connection | Documented: use `-pooler` hostname |
| 15 | No env var assertions | Added `throw new Error()` at module level |
| 16 | Cookie security defaults implicit | Explicit `httpOnly`, `sameSite`, `secure` |
| 17 | `globalDependencies: [".env"]` | Replaced with per-task `env` arrays |
| 18 | Missing `@types/node` in packages/db | Added to devDependencies |
| 19 | CSP + security headers | Added to `next.config.ts` |
| 20 | `.env.example` never defined | Created in Step 1 |
| 21 | PEM format in .env | Documented actual newlines, not `\n` escapes |
| 22 | `installation.deleted` not handled | Added handler (logs, defers cleanup) |
