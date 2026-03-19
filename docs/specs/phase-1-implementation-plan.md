# Phase 1: Foundation — Implementation Plan

> **Goal:** Transform the CLI repo into a Turborepo monorepo with auth, database, and a basic dashboard — while keeping the existing CLI functional.

**Spec reference:** `docs/specs/platform-design.md` (Sections 2-5, 12-13)

---

## Architecture Decisions (Phase 1 Scope)

| Decision | Choice | Why |
|----------|--------|-----|
| Package manager | **pnpm** | Turborepo's recommended manager, strict hoisting, fastest installs |
| Monorepo tool | **Turborepo** | Already using Vercel ecosystem (Next.js on Vercel), excellent caching |
| DB driver | **@neondatabase/serverless** (neon-http) | Serverless-compatible, works in Vercel functions + Fly.io + Trigger.dev |
| ORM | **Drizzle ORM** | Type-safe, lightweight, first-class Neon support, schema-as-code |
| Auth | **Better Auth** + **better-auth-ui** | OSS, Drizzle adapter, GitHub OAuth, JWT plugin for cross-origin, shadcn UI components |
| UI | **Next.js 16** + **shadcn/ui** (preset auFzGMc) + **Tailwind v4** | Spec requirement. Next.js 16 uses `proxy.ts` instead of `middleware.ts` |
| CSS | **Tailwind v4** | `@theme inline` blocks, no tailwind.config.js needed |

---

## Task Overview

| # | Task | What it produces | Estimated steps |
|---|------|-----------------|-----------------|
| 1 | Monorepo scaffold | Root config, workspace structure, turbo.json | ~15 |
| 2 | Move CLI → packages/core | Existing code as importable library | ~12 |
| 3 | packages/config | Shared env validation (base + per-service extend) | ~8 |
| 4 | packages/db | Drizzle schema, Neon client, migrations | ~20 |
| 5 | apps/web scaffold | Next.js 16 + shadcn + Tailwind v4 | ~15 |
| 6 | Better Auth setup | GitHub OAuth, Drizzle adapter, JWT plugin, auth UI | ~25 |
| 7 | GitHub App + webhooks | Installation webhook handler, repo creation | ~20 |
| 8 | Dashboard UI | Repo list, empty states, status badges, add repo flow | ~20 |
| 9 | apps/api scaffold | Hono skeleton on Node.js (no routes yet, just health + auth middleware) | ~12 |
| 10 | apps/trigger scaffold | Trigger.dev config, placeholder task | ~10 |
| 11 | CI/CD update | GitHub Actions for monorepo, turbo cache | ~8 |

---

## Task 1: Monorepo Scaffold

**Goal:** Set up the Turborepo monorepo structure with pnpm workspaces.

**Files to create:**
- `pnpm-workspace.yaml`
- `turbo.json`
- Root `package.json` (rewrite)
- Root `tsconfig.json` (rewrite as base config)
- `packages/tsconfig/base.json` — shared TS config
- `packages/tsconfig/nextjs.json` — Next.js-specific TS config
- `packages/tsconfig/library.json` — library packages TS config
- `packages/tsconfig/package.json`
- `.npmrc`

**Steps:**

1. **Initialize pnpm.** The existing project uses npm. We need to switch.
   ```bash
   # Remove npm lockfile
   rm package-lock.json

   # Install pnpm globally if not present
   npm install -g pnpm

   # Create pnpm workspace config
   ```

2. **Create `pnpm-workspace.yaml`:**
   ```yaml
   packages:
     - "apps/*"
     - "packages/*"
   ```

3. **Create `.npmrc`:**
   ```ini
   auto-install-peers=true
   strict-peer-dependencies=false
   ```

4. **Rewrite root `package.json`:**
   ```json
   {
     "name": "codeindexer",
     "private": true,
     "scripts": {
       "build": "turbo run build",
       "dev": "turbo run dev",
       "dev:web": "turbo run dev --filter=@codeindexer/web",
       "dev:api": "turbo run dev --filter=@codeindexer/api",
       "lint": "turbo run lint",
       "lint:fix": "turbo run lint:fix",
       "format": "prettier --write \"**/*.{ts,tsx,md,json}\"",
       "format:check": "prettier --check \"**/*.{ts,tsx,md,json}\"",
       "typecheck": "turbo run typecheck",
       "test": "turbo run test",
       "db:generate": "turbo run db:generate --filter=@codeindexer/db",
       "db:migrate": "turbo run db:migrate --filter=@codeindexer/db",
       "db:push": "turbo run db:push --filter=@codeindexer/db",
       "db:studio": "turbo run db:studio --filter=@codeindexer/db",
       "clean": "turbo run clean && rm -rf node_modules .turbo"
     },
     "devDependencies": {
       "turbo": "^2.4.4",
       "prettier": "^3.8.1",
       "@types/node": "^22.19.15",
       "typescript": "^5.9.3"
     },
     "packageManager": "pnpm@9.15.4",
     "engines": {
       "node": ">=20.0.0"
     }
   }
   ```

5. **Create `turbo.json`:**
   ```json
   {
     "$schema": "https://turbo.build/schema.json",
     "ui": "tui",
     "globalDependencies": [".env"],
     "tasks": {
       "build": {
         "dependsOn": ["^build"],
         "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
       },
       "dev": {
         "cache": false,
         "persistent": true
       },
       "lint": {
         "dependsOn": ["^build"]
       },
       "lint:fix": {
         "dependsOn": ["^build"]
       },
       "typecheck": {
         "dependsOn": ["^build"]
       },
       "test": {
         "dependsOn": ["^build"]
       },
       "clean": {
         "cache": false
       },
       "db:generate": {
         "cache": false
       },
       "db:migrate": {
         "cache": false
       },
       "db:push": {
         "cache": false
       },
       "db:studio": {
         "cache": false,
         "persistent": true
       }
     }
   }
   ```

6. **Create shared TypeScript configs in `packages/tsconfig/`:**

   `packages/tsconfig/base.json`:
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
       "incremental": true,
       "declaration": true,
       "declarationMap": true,
       "sourceMap": true,
       "noUncheckedIndexedAccess": true,
       "forceConsistentCasingInFileNames": true
     },
     "exclude": ["node_modules", "dist"]
   }
   ```

   `packages/tsconfig/library.json`:
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

   `packages/tsconfig/nextjs.json`:
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

   `packages/tsconfig/package.json`:
   ```json
   {
     "name": "@codeindexer/tsconfig",
     "version": "0.0.0",
     "private": true,
     "license": "ISC",
     "files": ["base.json", "library.json", "nextjs.json"]
   }
   ```

7. **Create directory structure:**
   ```bash
   mkdir -p apps/web apps/api apps/trigger
   mkdir -p packages/core packages/db packages/config
   ```

8. **Update root `.gitignore`** — add Turborepo cache:
   ```
   # Turborepo
   .turbo
   ```

9. **Run `pnpm install`** to generate lockfile.

10. **Commit:** `feat: scaffold turborepo monorepo structure`

---

## Task 2: Move CLI Code → packages/core

**Goal:** Move existing `src/` into `packages/core/src/` so it becomes an importable library. Keep the CLI entry point working as a separate concern.

**Key constraint:** The CLI (`src/index.ts`) uses `commander` and is the entry point. This stays at root level (or becomes its own app later). The library code (chunker, embedder, store, sync, search, etc.) moves to `packages/core`.

**Files to create/move:**
- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `packages/core/src/` — all library code from `src/`
- Root `src/index.ts` — updated imports pointing to `@codeindexer/core`

**Steps:**

1. **Create `packages/core/package.json`:**
   ```json
   {
     "name": "@codeindexer/core",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "exports": {
       ".": "./src/index.ts",
       "./chunker": "./src/chunker/index.ts",
       "./lib/*": "./src/lib/*.ts",
       "./utils/*": "./src/utils/*.ts"
     },
     "scripts": {
       "typecheck": "tsc --noEmit",
       "lint": "eslint src/",
       "lint:fix": "eslint src/ --fix",
       "test": "vitest run",
       "test:watch": "vitest",
       "clean": "rm -rf dist .turbo"
     },
     "dependencies": {
       "better-sqlite3": "^12.8.0",
       "commander": "^14.0.3",
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

2. **Create `packages/core/tsconfig.json`:**
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

3. **Move source files:**
   ```bash
   # Move all library code
   cp -r src/chunker packages/core/src/chunker
   cp -r src/lib packages/core/src/lib
   cp -r src/utils packages/core/src/utils
   cp src/config/env.ts packages/core/src/config/env.ts
   ```

4. **Create `packages/core/src/index.ts`** — barrel export for the library:
   ```typescript
   // Core pipeline exports
   export { chunkFile } from './chunker/index.js'
   export type { Chunk } from './chunker/types.js'

   export { walkFiles, isBinary } from './lib/walker.js'
   export { embedChunks, embedQuery, embedBatch, getProvider } from './lib/embedder.js'
   export type { EmbeddingProvider } from './lib/embedder.js'
   export { hashFile, hashString } from './lib/hash.js'
   export { computeChanges, persistMerkleState } from './lib/sync.js'
   export type { SyncResult, MerkleTree } from './lib/sync.js'

   export { ensureCollection, upsertPoints, deletePoints, searchPoints } from './lib/store.js'
   export type { PointPayload, SearchResult, UpsertPoint } from './lib/store.js'

   export { semanticSearch, readCodeSnippet, DEFAULT_LIMIT } from './lib/search.js'
   export type { CodeSearchResult } from './lib/search.js'
   export { grepSearch } from './lib/grep.js'
   export { mergeResults, RRF_K } from './lib/merge.js'

   export { LANGUAGE_MAP, AST_LANGUAGES, TEXT_LANGUAGES, getLanguage, getSupportedExtensions } from './lib/languages.js'
   export type { LanguageEntry } from './lib/languages.js'

   export { initDb, getDb, closeDb, getDbPath } from './lib/db.js'
   export { createLogger, rootLogger } from './utils/logger.js'
   export { onShutdown, runCleanup, registerShutdownHandlers } from './lib/shutdown.js'
   ```

5. **Move test files** alongside their source files in `packages/core/`.

6. **Create `packages/core/vitest.config.ts`:**
   ```typescript
   import { defineConfig } from 'vitest/config'

   export default defineConfig({
     test: {
       include: ['src/**/*.test.ts'],
       coverage: {
         provider: 'v8',
         exclude: ['src/index.ts'],
       },
     },
   })
   ```

7. **Move ESLint config** to `packages/core/eslint.config.mjs` (copy from root).

8. **Update root CLI entry point** (`src/index.ts`) to import from `@codeindexer/core`:
   - Change all `./lib/*` imports to `@codeindexer/core`
   - Change `./chunker/*` imports to `@codeindexer/core/chunker`
   - Change `./config/env` to `@codeindexer/core` or keep local

   **Note:** For now, keep `src/index.ts` at root as the CLI entry. It becomes a thin CLI wrapper that imports everything from `@codeindexer/core`. In a future task, this moves to `apps/cli/`.

9. **Verify:** Run `pnpm typecheck` and `pnpm test` from root to ensure everything still works.

10. **Commit:** `refactor: move CLI library code to packages/core`

---

## Task 3: packages/config — Shared Env Validation

**Goal:** Create the shared config package with base Zod env schema that each service extends.

**Files to create:**
- `packages/config/package.json`
- `packages/config/tsconfig.json`
- `packages/config/src/env.ts`
- `packages/config/src/constants.ts`
- `packages/config/src/index.ts`

**Steps:**

1. **Create `packages/config/package.json`:**
   ```json
   {
     "name": "@codeindexer/config",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "exports": {
       ".": "./src/index.ts",
       "./env": "./src/env.ts",
       "./constants": "./src/constants.ts"
     },
     "dependencies": {
       "zod": "^4.3.6"
     },
     "devDependencies": {
       "@codeindexer/tsconfig": "workspace:*",
       "typescript": "^5.9.3"
     }
   }
   ```

2. **Create `packages/config/src/env.ts`:**
   ```typescript
   import { z } from 'zod/v4'

   // Base env shared by all services
   export const baseEnvSchema = z.object({
     NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
     LOG_LEVEL: z
       .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
       .default('info'),
     DATABASE_URL: z.url(),
   })

   // Web-specific (Next.js)
   export const webEnvSchema = baseEnvSchema.extend({
     BETTER_AUTH_SECRET: z.string().min(32),
     BETTER_AUTH_URL: z.url(),
     GITHUB_CLIENT_ID: z.string(),
     GITHUB_CLIENT_SECRET: z.string(),
     GITHUB_APP_ID: z.string(),
     GITHUB_APP_PRIVATE_KEY: z.string(),
     GITHUB_APP_WEBHOOK_SECRET: z.string(),
     JWT_PRIVATE_KEY: z.string(), // RS256 private key (PEM)
     JWT_PUBLIC_KEY: z.string(),  // RS256 public key (PEM)
     R2_ACCESS_KEY_ID: z.string().optional(),
     R2_SECRET_ACCESS_KEY: z.string().optional(),
     R2_BUCKET: z.string().optional(),
     R2_ENDPOINT: z.url().optional(),
     TRIGGER_SECRET_KEY: z.string().optional(),
   })

   // API-specific (Hono)
   export const apiEnvSchema = baseEnvSchema.extend({
     PORT: z.coerce.number().default(3001),
     FRONTEND_URL: z.url(),
     JWT_PUBLIC_KEY: z.string(), // Only public key — cannot sign tokens
     OPENAI_API_KEY: z.string(),
     QDRANT_URL: z.url(),
     QDRANT_KEY: z.string(),
     ANTHROPIC_API_KEY: z.string(),
     R2_ACCESS_KEY_ID: z.string().optional(),
     R2_SECRET_ACCESS_KEY: z.string().optional(),
     R2_BUCKET: z.string().optional(),
     R2_ENDPOINT: z.url().optional(),
   })

   // Trigger-specific (background workers)
   export const triggerEnvSchema = baseEnvSchema.extend({
     OPENAI_API_KEY: z.string(),
     QDRANT_URL: z.url(),
     QDRANT_KEY: z.string(),
     R2_ACCESS_KEY_ID: z.string(),
     R2_SECRET_ACCESS_KEY: z.string(),
     R2_BUCKET: z.string(),
     R2_ENDPOINT: z.url(),
     GITHUB_APP_ID: z.string(),
     GITHUB_APP_PRIVATE_KEY: z.string(),
   })

   // Helper: parse env and throw on failure
   export function parseEnv<T extends z.ZodType>(schema: T, env = process.env): z.infer<T> {
     const result = schema.safeParse(env)
     if (!result.success) {
       console.error('❌ Invalid environment variables:')
       console.error(z.prettifyError(result.error))
       throw new Error('Invalid environment variables')
     }
     return result.data
   }
   ```

3. **Create `packages/config/src/constants.ts`:**
   ```typescript
   // Qdrant
   export const QDRANT_COLLECTION = 'code-indexer'
   export const QDRANT_VECTOR_DIM = 1536 // OpenAI text-embedding-3-small

   // R2
   export const R2_REPO_PREFIX = 'repos'

   // Embedding
   export const EMBEDDING_MODEL = 'text-embedding-3-small'
   export const EMBEDDING_BATCH_SIZE = 128

   // Rate limits
   export const RATE_LIMIT_CHAT = 20      // per minute
   export const RATE_LIMIT_SEARCH = 60    // per minute
   export const RATE_LIMIT_AGENT = 5      // per minute

   // Repo statuses
   export const REPO_STATUSES = [
     'pending', 'cloning', 'indexing', 'ready', 'error', 'stale', 'deleting'
   ] as const
   export type RepoStatus = (typeof REPO_STATUSES)[number]
   ```

4. **Create `packages/config/src/index.ts`:**
   ```typescript
   export * from './env.js'
   export * from './constants.js'
   ```

5. **Commit:** `feat: add shared config package with env schemas and constants`

---

## Task 4: packages/db — Drizzle Schema + Neon Client

**Goal:** Define the full database schema from Section 5 of the spec using Drizzle ORM, connected to Neon Postgres.

**Files to create:**
- `packages/db/package.json`
- `packages/db/tsconfig.json`
- `packages/db/drizzle.config.ts`
- `packages/db/src/index.ts`
- `packages/db/src/client.ts`
- `packages/db/src/schema.ts` — all table definitions
- `packages/db/src/relations.ts` — Drizzle relations
- `packages/db/src/migrate.ts`

**Steps:**

1. **Create `packages/db/package.json`:**
   ```json
   {
     "name": "@codeindexer/db",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "exports": {
       ".": "./src/index.ts",
       "./client": "./src/client.ts",
       "./schema": "./src/schema.ts"
     },
     "scripts": {
       "typecheck": "tsc --noEmit",
       "db:generate": "drizzle-kit generate",
       "db:migrate": "drizzle-kit migrate",
       "db:push": "drizzle-kit push",
       "db:studio": "drizzle-kit studio",
       "clean": "rm -rf dist .turbo"
     },
     "dependencies": {
       "@codeindexer/config": "workspace:*",
       "@neondatabase/serverless": "^1.0.0",
       "drizzle-orm": "^0.44.0"
     },
     "devDependencies": {
       "@codeindexer/tsconfig": "workspace:*",
       "drizzle-kit": "^0.31.0",
       "typescript": "^5.9.3"
     }
   }
   ```

2. **Create `packages/db/src/schema.ts`** — full schema from spec Section 5:
   ```typescript
   import { relations } from 'drizzle-orm'
   import {
     pgTable,
     text,
     uuid,
     bigint,
     integer,
     timestamp,
     jsonb,
     uniqueIndex,
     index,
   } from 'drizzle-orm/pg-core'

   // ─── Better Auth tables ───
   // These are managed by Better Auth CLI (`npx auth generate`)
   // We define them here so Drizzle knows about them for relations/queries
   // Schema must match what Better Auth generates

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

   // ─── Application tables ───

   export const repos = pgTable('repos', {
     id: uuid('id').primaryKey().defaultRandom(),
     userId: text('user_id')
       .notNull()
       .references(() => user.id, { onDelete: 'cascade' }),

     // GitHub metadata
     githubId: bigint('github_id', { mode: 'number' }).notNull(),
     fullName: text('full_name').notNull(),
     defaultBranch: text('default_branch').notNull().default('main'),
     installationId: bigint('installation_id', { mode: 'number' }).notNull(),

     // Indexing state
     status: text('status').notNull().default('pending'),
     lastIndexedAt: timestamp('last_indexed_at', { withTimezone: true, mode: 'date' }),
     lastCommitSha: text('last_commit_sha'),
     indexError: text('index_error'),

     // Storage
     r2TarKey: text('r2_tar_key'),

     // Stats
     fileCount: integer('file_count').default(0),
     chunkCount: integer('chunk_count').default(0),

     createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
     updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
   }, (table) => [
     uniqueIndex('repos_user_github_idx').on(table.userId, table.githubId),
   ])

   export const fileHashes = pgTable('file_hashes', {
     id: uuid('id').primaryKey().defaultRandom(),
     repoId: uuid('repo_id')
       .notNull()
       .references(() => repos.id, { onDelete: 'cascade' }),
     filePath: text('file_path').notNull(),
     sha256: text('sha256').notNull(),
     updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
   }, (table) => [
     uniqueIndex('file_hashes_repo_path_idx').on(table.repoId, table.filePath),
   ])

   export const chunkCache = pgTable('chunk_cache', {
     id: uuid('id').primaryKey().defaultRandom(),
     repoId: uuid('repo_id')
       .notNull()
       .references(() => repos.id, { onDelete: 'cascade' }),
     chunkHash: text('chunk_hash').notNull(),
     qdrantId: text('qdrant_id').notNull(),
     filePath: text('file_path').notNull(),
     lineStart: integer('line_start').notNull(),
     lineEnd: integer('line_end').notNull(),
   }, (table) => [
     uniqueIndex('chunk_cache_repo_hash_idx').on(table.repoId, table.chunkHash),
     index('chunk_cache_repo_file_idx').on(table.repoId, table.filePath),
   ])

   export const dirHashes = pgTable('dir_hashes', {
     id: uuid('id').primaryKey().defaultRandom(),
     repoId: uuid('repo_id')
       .notNull()
       .references(() => repos.id, { onDelete: 'cascade' }),
     dirPath: text('dir_path').notNull(),
     merkleHash: text('merkle_hash').notNull(),
     updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
   }, (table) => [
     uniqueIndex('dir_hashes_repo_path_idx').on(table.repoId, table.dirPath),
   ])

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
   })

   export const messages = pgTable('messages', {
     id: uuid('id').primaryKey().defaultRandom(),
     conversationId: uuid('conversation_id')
       .notNull()
       .references(() => conversations.id, { onDelete: 'cascade' }),
     role: text('role').notNull(), // 'user' | 'assistant' | 'tool'
     content: text('content').notNull(),
     toolCalls: jsonb('tool_calls'),
     toolResults: jsonb('tool_results'),
     tokensUsed: integer('tokens_used'),
     model: text('model'),
     createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
   }, (table) => [
     index('messages_convo_idx').on(table.conversationId, table.createdAt),
   ])

   export const indexJobs = pgTable('index_jobs', {
     id: uuid('id').primaryKey().defaultRandom(),
     repoId: uuid('repo_id')
       .notNull()
       .references(() => repos.id, { onDelete: 'cascade' }),
     triggerRunId: text('trigger_run_id'),
     status: text('status').notNull().default('pending'),
     trigger: text('trigger').notNull(), // 'manual' | 'webhook' | 'initial'
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

3. **Create `packages/db/src/relations.ts`:**
   ```typescript
   import { relations } from 'drizzle-orm'
   import {
     user, session, account,
     repos, fileHashes, chunkCache, dirHashes,
     conversations, messages, indexJobs,
   } from './schema.js'

   export const userRelations = relations(user, ({ many }) => ({
     sessions: many(session),
     accounts: many(account),
     repos: many(repos),
     conversations: many(conversations),
   }))

   export const sessionRelations = relations(session, ({ one }) => ({
     user: one(user, { fields: [session.userId], references: [user.id] }),
   }))

   export const accountRelations = relations(account, ({ one }) => ({
     user: one(user, { fields: [account.userId], references: [user.id] }),
   }))

   export const reposRelations = relations(repos, ({ one, many }) => ({
     user: one(user, { fields: [repos.userId], references: [user.id] }),
     fileHashes: many(fileHashes),
     chunkCache: many(chunkCache),
     dirHashes: many(dirHashes),
     conversations: many(conversations),
     indexJobs: many(indexJobs),
   }))

   export const fileHashesRelations = relations(fileHashes, ({ one }) => ({
     repo: one(repos, { fields: [fileHashes.repoId], references: [repos.id] }),
   }))

   export const chunkCacheRelations = relations(chunkCache, ({ one }) => ({
     repo: one(repos, { fields: [chunkCache.repoId], references: [repos.id] }),
   }))

   export const dirHashesRelations = relations(dirHashes, ({ one }) => ({
     repo: one(repos, { fields: [dirHashes.repoId], references: [repos.id] }),
   }))

   export const conversationsRelations = relations(conversations, ({ one, many }) => ({
     repo: one(repos, { fields: [conversations.repoId], references: [repos.id] }),
     user: one(user, { fields: [conversations.userId], references: [user.id] }),
     messages: many(messages),
   }))

   export const messagesRelations = relations(messages, ({ one }) => ({
     conversation: one(conversations, {
       fields: [messages.conversationId],
       references: [conversations.id],
     }),
   }))

   export const indexJobsRelations = relations(indexJobs, ({ one }) => ({
     repo: one(repos, { fields: [indexJobs.repoId], references: [repos.id] }),
   }))
   ```

4. **Create `packages/db/src/client.ts`:**
   ```typescript
   import { drizzle } from 'drizzle-orm/neon-http'
   import { neon } from '@neondatabase/serverless'
   import * as schema from './schema.js'
   import * as relations from './relations.js'

   export function createDb(databaseUrl: string) {
     const sql = neon(databaseUrl)
     return drizzle({
       client: sql,
       schema: { ...schema, ...relations },
     })
   }

   export type Database = ReturnType<typeof createDb>
   ```

5. **Create `packages/db/src/index.ts`:**
   ```typescript
   export * from './schema.js'
   export * from './relations.js'
   export { createDb, type Database } from './client.js'
   ```

6. **Create `packages/db/drizzle.config.ts`:**
   ```typescript
   import 'dotenv/config'
   import { defineConfig } from 'drizzle-kit'

   export default defineConfig({
     out: './drizzle',
     schema: './src/schema.ts',
     dialect: 'postgresql',
     dbCredentials: {
       url: process.env.DATABASE_URL!,
     },
   })
   ```

7. **Create Neon database:** Sign up at neon.tech, create project "codeindexer", copy DATABASE_URL.

8. **Generate initial migration:**
   ```bash
   cd packages/db
   pnpm db:generate  # Creates drizzle/0000_*.sql
   ```

9. **Push schema to Neon (dev):**
   ```bash
   pnpm db:push
   ```

10. **Verify with Drizzle Studio:**
    ```bash
    pnpm db:studio
    ```

11. **Commit:** `feat: add packages/db with Drizzle schema and Neon client`

---

## Task 5: apps/web — Next.js 16 Scaffold

**Goal:** Set up the Next.js app with shadcn/ui and Tailwind v4.

**Steps:**

1. **Create Next.js app:**
   ```bash
   cd apps
   pnpm create next-app@latest web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
   ```

2. **Update `apps/web/package.json`:**
   - Set name to `@codeindexer/web`
   - Add workspace dependencies:
     ```json
     {
       "dependencies": {
         "@codeindexer/db": "workspace:*",
         "@codeindexer/config": "workspace:*"
       }
     }
     ```

3. **Update `apps/web/tsconfig.json`** to extend shared config:
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

4. **Initialize shadcn with the preset from spec:**
   ```bash
   cd apps/web
   npx shadcn@latest init --preset auFzGMc
   ```
   This sets up Tailwind v4, CSS variables, and the component system.

5. **Add essential shadcn components:**
   ```bash
   npx shadcn@latest add button card badge avatar separator skeleton
   ```

6. **Create `apps/web/proxy.ts`** (Next.js 16 — replaces middleware.ts):
   ```typescript
   import { NextRequest, NextResponse } from 'next/server'

   const protectedRoutes = ['/dashboard', '/repo']
   const publicRoutes = ['/login', '/', '/api/webhooks/github']

   export default async function proxy(req: NextRequest) {
     const path = req.nextUrl.pathname
     const isProtected = protectedRoutes.some((r) => path.startsWith(r))

     if (isProtected) {
       // Check for session cookie (Better Auth sets this)
       const sessionToken = req.cookies.get('better-auth.session_token')
       if (!sessionToken) {
         return NextResponse.redirect(new URL('/login', req.nextUrl))
       }
     }

     return NextResponse.next()
   }

   export const config = {
     matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
   }
   ```

7. **Set up basic route structure:**
   ```
   apps/web/src/app/
   ├── (auth)/
   │   └── login/
   │       └── page.tsx        # Login page
   ├── dashboard/
   │   ├── page.tsx            # Repo list
   │   └── settings/
   │       └── page.tsx        # Settings
   ├── repo/
   │   └── [repoId]/
   │       └── page.tsx        # Web IDE (future)
   ├── api/
   │   ├── auth/
   │   │   └── [...all]/
   │   │       └── route.ts    # Better Auth handler
   │   └── webhooks/
   │       └── github/
   │           └── route.ts    # GitHub webhook handler
   ├── layout.tsx              # Root layout
   └── page.tsx                # Landing page
   ```

8. **Commit:** `feat: scaffold Next.js 16 app with shadcn and Tailwind v4`

---

## Task 6: Better Auth Setup

**Goal:** Wire up GitHub OAuth login, Drizzle adapter, JWT plugin, and auth UI components.

**Files to create:**
- `apps/web/src/lib/auth.ts` — server-side Better Auth config
- `apps/web/src/lib/auth-client.ts` — client-side auth client
- `apps/web/src/app/api/auth/[...all]/route.ts` — catch-all auth handler
- `apps/web/src/app/(auth)/login/page.tsx` — login page with Better Auth UI
- `apps/web/src/app/(auth)/[pathname]/page.tsx` — dynamic auth views
- `apps/web/src/components/providers.tsx` — AuthUIProvider wrapper

**Steps:**

1. **Install Better Auth + Better Auth UI:**
   ```bash
   cd apps/web
   pnpm add better-auth @daveyplate/better-auth-ui
   ```

2. **Create `apps/web/src/lib/auth.ts`** — server config:
   ```typescript
   import { betterAuth } from 'better-auth'
   import { drizzleAdapter } from 'better-auth/adapters/drizzle'
   import { jwt } from 'better-auth/plugins'
   import { createDb } from '@codeindexer/db/client'

   const db = createDb(process.env.DATABASE_URL!)

   export const auth = betterAuth({
     database: drizzleAdapter(db, { provider: 'pg' }),
     baseURL: process.env.BETTER_AUTH_URL,
     secret: process.env.BETTER_AUTH_SECRET,

     socialProviders: {
       github: {
         clientId: process.env.GITHUB_CLIENT_ID!,
         clientSecret: process.env.GITHUB_CLIENT_SECRET!,
         // Request user:email scope (default for identity)
       },
     },

     plugins: [
       jwt({
         jwks: {
           // RS256 asymmetric — Hono verifies with public key only
           keyPairConfig: {
             alg: 'RS256',
           },
         },
         jwt: {
           issuer: 'codeindexer-web',
           audience: 'codeindexer-api',
           expirationTime: '15m',
         },
       }),
     ],

     session: {
       expiresIn: 60 * 60 * 24 * 7, // 7 days
       updateAge: 60 * 60 * 24,      // refresh every 24h
     },
   })

   export type Session = typeof auth.$Infer.Session
   ```

3. **Create `apps/web/src/lib/auth-client.ts`** — client config:
   ```typescript
   import { createAuthClient } from 'better-auth/react'
   import { jwtClient } from 'better-auth/client/plugins'

   export const authClient = createAuthClient({
     baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? 'http://localhost:3000',
     plugins: [jwtClient()],
   })
   ```

4. **Create auth API route** `apps/web/src/app/api/auth/[...all]/route.ts`:
   ```typescript
   import { auth } from '@/lib/auth'
   import { toNextJsHandler } from 'better-auth/next-js'

   export const { POST, GET } = toNextJsHandler(auth)
   ```

5. **Create `apps/web/src/components/providers.tsx`:**
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

6. **Update `apps/web/src/app/layout.tsx`** to wrap with Providers.

7. **Create login page** `apps/web/src/app/(auth)/login/page.tsx`:
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

8. **Generate Better Auth DB tables:**
   ```bash
   cd apps/web
   npx auth generate --output ../../packages/db/src/auth-schema.ts
   ```
   Then compare with our manually defined schema in `packages/db/src/schema.ts` and reconcile. Better Auth's CLI generates the tables it needs — we need to make sure our schema matches.

9. **Push updated schema:**
   ```bash
   cd packages/db
   pnpm db:push
   ```

10. **Test:** Start the dev server, visit `/login`, sign in with GitHub. Verify:
    - OAuth redirect works
    - User created in `user` table
    - Session created
    - Redirected to `/dashboard`

11. **Commit:** `feat: add Better Auth with GitHub OAuth and JWT plugin`

---

## Task 7: GitHub App + Webhook Handler

**Goal:** Create a GitHub App, handle installation webhooks, and create repo records.

**Steps:**

1. **Create GitHub App** (manual, in GitHub Developer Settings):
   - Name: `CodeIndexer-Dev` (use `-Dev` suffix for development)
   - Homepage URL: `http://localhost:3000`
   - Callback URL: `http://localhost:3000/api/auth/callback/github`
   - Webhook URL: `http://localhost:3000/api/webhooks/github` (use smee.io or ngrok for local dev)
   - Webhook secret: generate random string
   - Permissions:
     - Repository contents: Read
     - Repository metadata: Read
     - Pull requests: Write (future)
   - Subscribe to events: `push`, `installation`, `installation_repositories`
   - Generate private key (.pem)

2. **Add env vars to `.env`:**
   ```
   GITHUB_APP_ID=<app-id>
   GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
   GITHUB_APP_WEBHOOK_SECRET=<webhook-secret>
   GITHUB_CLIENT_ID=<client-id>
   GITHUB_CLIENT_SECRET=<client-secret>
   ```

3. **Create webhook handler** `apps/web/src/app/api/webhooks/github/route.ts`:
   ```typescript
   import { createHmac, timingSafeEqual } from 'crypto'
   import { NextRequest, NextResponse } from 'next/server'
   import { createDb } from '@codeindexer/db/client'
   import { repos, account } from '@codeindexer/db/schema'
   import { eq, and } from 'drizzle-orm'

   const db = createDb(process.env.DATABASE_URL!)

   function verifySignature(body: string, signature: string, secret: string): boolean {
     const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
     try {
       return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
     } catch {
       return false
     }
   }

   export async function POST(req: NextRequest) {
     const body = await req.text()
     const signature = req.headers.get('X-Hub-Signature-256')
     const event = req.headers.get('X-GitHub-Event')

     if (!signature || !verifySignature(body, signature, process.env.GITHUB_APP_WEBHOOK_SECRET!)) {
       return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
     }

     const payload = JSON.parse(body)

     switch (event) {
       case 'installation':
         await handleInstallation(payload)
         break
       case 'installation_repositories':
         await handleInstallationRepositories(payload)
         break
       case 'push':
         await handlePush(payload)
         break
     }

     return NextResponse.json({ ok: true })
   }

   async function handleInstallation(payload: any) {
     const { action, installation, repositories } = payload

     if (action === 'created') {
       // Map GitHub account ID → our user
       const githubAccountId = String(installation.account.id)
       const userAccount = await db.query.account.findFirst({
         where: and(
           eq(account.providerId, 'github'),
           eq(account.accountId, githubAccountId),
         ),
       })

       if (!userAccount) {
         // Edge case: user hasn't logged in yet. Store pending.
         // TODO: Handle pending installations
         return
       }

       // Create repo records
       if (repositories) {
         for (const repo of repositories) {
           await db.insert(repos).values({
             userId: userAccount.userId,
             githubId: repo.id,
             fullName: repo.full_name,
             defaultBranch: 'main', // Will be updated during indexing
             installationId: installation.id,
             status: 'pending',
           }).onConflictDoNothing()

           // TODO (Phase 2): Trigger index-repo task
         }
       }
     }

     if (action === 'deleted') {
       // TODO: Mark repos for cleanup
     }
   }

   async function handleInstallationRepositories(payload: any) {
     const { action, installation, repositories_added, repositories_removed } = payload

     if (repositories_added) {
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
           githubId: repo.id,
           fullName: repo.full_name,
           defaultBranch: 'main',
           installationId: installation.id,
           status: 'pending',
         }).onConflictDoNothing()
       }
     }

     // TODO: Handle repositories_removed
   }

   async function handlePush(payload: any) {
     // TODO (Phase 2): Trigger sync-repo task
     const { repository, after: commitSha, installation } = payload
     const repo = await db.query.repos.findFirst({
       where: eq(repos.githubId, repository.id),
     })
     if (!repo) return
     // Will trigger sync-repo in Phase 2
   }
   ```

4. **For local development,** set up webhook forwarding:
   ```bash
   # Option A: smee.io
   npx smee -u https://smee.io/<your-channel> --target http://localhost:3000/api/webhooks/github

   # Option B: ngrok
   ngrok http 3000
   ```

5. **Commit:** `feat: add GitHub App webhook handler for installation events`

---

## Task 8: Dashboard UI

**Goal:** Build the dashboard page showing repo list with status badges, empty state, and "Add Repository" flow.

**Files to create:**
- `apps/web/src/app/dashboard/page.tsx`
- `apps/web/src/app/dashboard/layout.tsx`
- `apps/web/src/components/dashboard/repo-list.tsx`
- `apps/web/src/components/dashboard/repo-card.tsx`
- `apps/web/src/components/dashboard/empty-state.tsx`
- `apps/web/src/components/dashboard/add-repo-button.tsx`
- `apps/web/src/components/dashboard/nav.tsx`
- `apps/web/src/lib/db.ts` — singleton DB instance for Next.js server
- `apps/web/src/app/dashboard/actions.ts` — server actions

**Steps:**

1. **Add more shadcn components:**
   ```bash
   cd apps/web
   npx shadcn@latest add dropdown-menu tooltip scroll-area
   ```

2. **Create `apps/web/src/lib/db.ts`** — singleton for server-side:
   ```typescript
   import { createDb } from '@codeindexer/db/client'

   // Singleton pattern for Next.js hot reload
   const globalForDb = globalThis as unknown as { db: ReturnType<typeof createDb> | undefined }
   export const db = globalForDb.db ?? createDb(process.env.DATABASE_URL!)
   if (process.env.NODE_ENV !== 'production') globalForDb.db = db
   ```

3. **Create server actions** `apps/web/src/app/dashboard/actions.ts`:
   ```typescript
   'use server'

   import { auth } from '@/lib/auth'
   import { headers } from 'next/headers'
   import { db } from '@/lib/db'
   import { repos } from '@codeindexer/db/schema'
   import { eq } from 'drizzle-orm'

   export async function getRepos() {
     const session = await auth.api.getSession({
       headers: await headers(),
     })
     if (!session) throw new Error('Unauthorized')

     return db.query.repos.findMany({
       where: eq(repos.userId, session.user.id),
       orderBy: (repos, { desc }) => [desc(repos.createdAt)],
     })
   }

   export async function getGitHubAppInstallUrl() {
     // Redirect user to GitHub App installation page
     const appSlug = 'codeindexer-dev' // matches your GitHub App URL name
     return `https://github.com/apps/${appSlug}/installations/new`
   }
   ```

4. **Create dashboard layout** with nav bar showing user avatar and sign out.

5. **Create `repo-card.tsx`** — displays repo name, status badge, last indexed time, file/chunk counts.
   Status badge colors:
   - `pending` → yellow
   - `cloning`/`indexing` → blue (with spinner)
   - `ready` → green
   - `error` → red
   - `stale` → gray

6. **Create `empty-state.tsx`** — "No repositories yet. Connect your GitHub repos to get started." with CTA button.

7. **Create `add-repo-button.tsx`** — "Add Repository" button that redirects to GitHub App install page.

8. **Create dashboard page** — fetches repos via server action, renders list or empty state.

9. **Commit:** `feat: add dashboard with repo list and empty state`

---

## Task 9: apps/api — Hono Skeleton

**Goal:** Scaffold the Hono API server with health check and auth middleware. No business routes yet (those come in Phase 3-4).

**Files to create:**
- `apps/api/package.json`
- `apps/api/tsconfig.json`
- `apps/api/src/index.ts` — Hono app entry
- `apps/api/src/middleware/auth.ts` — JWT verification
- `apps/api/Dockerfile` — for Fly.io deployment

**Steps:**

1. **Create `apps/api/package.json`:**
   ```json
   {
     "name": "@codeindexer/api",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "scripts": {
       "dev": "tsx watch src/index.ts",
       "build": "tsc",
       "start": "node dist/index.js",
       "typecheck": "tsc --noEmit",
       "clean": "rm -rf dist .turbo"
     },
     "dependencies": {
       "@codeindexer/config": "workspace:*",
       "@codeindexer/db": "workspace:*",
       "hono": "^4.7.0",
       "@hono/node-server": "^1.14.0",
       "jose": "^6.0.0"
     },
     "devDependencies": {
       "@codeindexer/tsconfig": "workspace:*",
       "tsx": "^4.21.0",
       "typescript": "^5.9.3"
     }
   }
   ```
   **Note:** We use `jose` for RS256 JWT verification (not hono/jwt which only supports HS256 by default). `jose` handles asymmetric keys properly.

2. **Create `apps/api/src/index.ts`:**
   ```typescript
   import { Hono } from 'hono'
   import { cors } from 'hono/cors'
   import { serve } from '@hono/node-server'

   const app = new Hono()

   app.use('/*', cors({
     origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
     credentials: true,
   }))

   app.get('/health', (c) => c.json({ ok: true, timestamp: new Date().toISOString() }))

   const port = Number(process.env.PORT ?? 3001)
   console.log(`Hono API starting on port ${port}`)

   serve({ fetch: app.fetch, port })

   export default app
   ```

3. **Create `apps/api/src/middleware/auth.ts`:**
   ```typescript
   import { createMiddleware } from 'hono/factory'
   import * as jose from 'jose'

   // RS256 public key — can only verify, not sign
   let publicKey: jose.KeyLike | null = null

   async function getPublicKey(): Promise<jose.KeyLike> {
     if (!publicKey) {
       const pem = process.env.JWT_PUBLIC_KEY!
       publicKey = await jose.importSPKI(pem, 'RS256')
     }
     return publicKey
   }

   export const authenticate = createMiddleware(async (c, next) => {
     const header = c.req.header('Authorization')
     if (!header?.startsWith('Bearer ')) {
       return c.json({ error: 'Missing authorization' }, 401)
     }

     const token = header.slice(7)
     try {
       const key = await getPublicKey()
       const { payload } = await jose.jwtVerify(token, key, {
         issuer: 'codeindexer-web',
         audience: 'codeindexer-api',
       })
       c.set('userId', payload.sub as string)
       c.set('userEmail', payload.email as string)
     } catch {
       return c.json({ error: 'Invalid or expired token' }, 401)
     }

     await next()
   })
   ```

4. **Create Dockerfile** for Fly.io:
   ```dockerfile
   FROM node:20-slim AS base
   RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

   FROM base AS build
   WORKDIR /app
   COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
   COPY packages/config/package.json packages/config/
   COPY packages/db/package.json packages/db/
   COPY packages/tsconfig/ packages/tsconfig/
   COPY apps/api/package.json apps/api/
   RUN pnpm install --frozen-lockfile

   COPY packages/ packages/
   COPY apps/api/ apps/api/
   RUN pnpm --filter @codeindexer/api build

   FROM base AS runtime
   WORKDIR /app
   COPY --from=build /app .
   EXPOSE 3001
   CMD ["node", "apps/api/dist/index.js"]
   ```

5. **Commit:** `feat: scaffold Hono API with health check and JWT auth middleware`

---

## Task 10: apps/trigger — Trigger.dev Scaffold

**Goal:** Set up Trigger.dev project with config and a placeholder task.

**Files to create:**
- `apps/trigger/package.json`
- `apps/trigger/tsconfig.json`
- `apps/trigger/trigger.config.ts`
- `apps/trigger/src/tasks/index-repo.ts` — placeholder

**Steps:**

1. **Create `apps/trigger/package.json`:**
   ```json
   {
     "name": "@codeindexer/trigger",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "scripts": {
       "dev": "npx trigger.dev dev",
       "deploy": "npx trigger.dev deploy",
       "typecheck": "tsc --noEmit",
       "clean": "rm -rf dist .turbo"
     },
     "dependencies": {
       "@codeindexer/config": "workspace:*",
       "@codeindexer/db": "workspace:*",
       "@codeindexer/core": "workspace:*",
       "@trigger.dev/sdk": "^4.0.0"
     },
     "devDependencies": {
       "@codeindexer/tsconfig": "workspace:*",
       "typescript": "^5.9.3"
     }
   }
   ```

2. **Create `apps/trigger/trigger.config.ts`:**
   ```typescript
   import { defineConfig } from '@trigger.dev/sdk/build'

   export default defineConfig({
     project: '<your-trigger-project-ref>', // from trigger.dev dashboard
     dirs: ['./src/tasks'],
     retries: {
       enabledInDev: false,
       default: {
         maxAttempts: 3,
         minTimeoutInMs: 1000,
         maxTimeoutInMs: 10000,
         factor: 2,
         randomize: true,
       },
     },
   })
   ```

3. **Create placeholder task** `apps/trigger/src/tasks/index-repo.ts`:
   ```typescript
   import { task } from '@trigger.dev/sdk'

   export const indexRepo = task({
     id: 'index-repo',
     retry: { maxAttempts: 3 },

     run: async ({ repoId }: { repoId: string }) => {
       console.log(`[index-repo] Starting for repo ${repoId}`)
       // Phase 2 implementation:
       // 1. Load repo metadata from Postgres
       // 2. Generate GitHub App installation token
       // 3. git clone --depth 1 to /tmp
       // 4. Walk → Chunk → Embed → Qdrant upsert
       // 5. Persist Merkle state
       // 6. Upload to R2
       // 7. Update repo status → 'ready'
       return { success: true, repoId }
     },
   })
   ```

4. **Sign up at trigger.dev**, create project, get project ref, update config.

5. **Commit:** `feat: scaffold Trigger.dev app with placeholder index-repo task`

---

## Task 11: CI/CD Update

**Goal:** Update GitHub Actions to work with the monorepo structure.

**Files to modify:**
- `.github/workflows/ci.yml`

**Steps:**

1. **Update CI workflow** for pnpm + Turborepo:
   ```yaml
   name: CI
   on:
     pull_request:
       branches: [main, staging]
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

         - name: Format check
           run: pnpm format:check

         - name: Lint
           run: pnpm lint

         - name: Typecheck
           run: pnpm typecheck

         - name: Test
           run: pnpm test

         - name: Build
           run: pnpm build
   ```

2. **Add Turborepo remote caching** (optional, speeds up CI):
   ```yaml
   - name: Build
     run: pnpm build
     env:
       TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
       TURBO_TEAM: ${{ vars.TURBO_TEAM }}
   ```

3. **Commit:** `ci: update GitHub Actions for pnpm + Turborepo monorepo`

---

## .env.example (Root)

```bash
# ─── Database ───
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/codeindexer?sslmode=require

# ─── Better Auth ───
BETTER_AUTH_SECRET=<random-32-char-string>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000

# ─── GitHub OAuth (from GitHub App settings) ───
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# ─── GitHub App ───
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET=

# ─── JWT (RS256 keypair — generate with: openssl genrsa -out private.pem 2048 && openssl rsa -in private.pem -pubout -out public.pem) ───
JWT_PRIVATE_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"

# ─── Hono API ───
PORT=3001
FRONTEND_URL=http://localhost:3000

# ─── OpenAI (embeddings) ───
OPENAI_API_KEY=

# ─── Qdrant ───
QDRANT_URL=
QDRANT_KEY=

# ─── Claude (chat/agent — Phase 4) ───
ANTHROPIC_API_KEY=

# ─── R2 (Phase 2) ───
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=codeindexer-dev
R2_ENDPOINT=

# ─── Trigger.dev ───
TRIGGER_SECRET_KEY=
```

---

## Execution Order & Dependencies

```
Task 1 (monorepo scaffold)
  └─→ Task 2 (move CLI → packages/core)
  └─→ Task 3 (packages/config)
  └─→ Task 4 (packages/db) — depends on Task 3
       └─→ Task 5 (apps/web scaffold)
            └─→ Task 6 (Better Auth) — depends on Task 4, 5
                 └─→ Task 7 (GitHub webhooks) — depends on Task 6
                 └─→ Task 8 (Dashboard UI) — depends on Task 6
       └─→ Task 9 (apps/api scaffold) — depends on Task 3, 4
       └─→ Task 10 (apps/trigger scaffold) — depends on Task 3, 4
  └─→ Task 11 (CI/CD) — can run anytime after Task 1

Parallelizable:
  - Tasks 9, 10, 11 can run in parallel with Tasks 6-8
  - Tasks 2, 3 can run in parallel
```

---

## Verification Checklist (End of Phase 1)

- [ ] `pnpm install` succeeds from root
- [ ] `pnpm build` builds all packages and apps
- [ ] `pnpm typecheck` passes across all workspaces
- [ ] `pnpm test` runs existing CLI tests in packages/core
- [ ] `pnpm lint` passes
- [ ] `pnpm format:check` passes
- [ ] Drizzle schema pushed to Neon, all tables visible in Studio
- [ ] GitHub OAuth login works (localhost:3000/login → GitHub → /dashboard)
- [ ] Session persisted (refresh page, still logged in)
- [ ] JWT token generation works (`authClient.token()` returns valid JWT)
- [ ] Dashboard shows empty state for new users
- [ ] GitHub App installation creates repo records in DB
- [ ] Webhook signature verification rejects forged requests
- [ ] Hono health check responds at localhost:3001/health
- [ ] Hono JWT auth middleware rejects invalid tokens
- [ ] CI pipeline passes on PR
- [ ] Existing CLI still works via `pnpm --filter @codeindexer/core test`
