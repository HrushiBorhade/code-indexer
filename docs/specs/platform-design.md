# CodeIndexer Platform — Design Spec

> Date: 2026-03-18
> Status: Draft
> Author: Hrushi + Claude

---

## 1. Product Vision

Turn CodeIndexer from a local CLI into a cloud platform where users connect GitHub repos, browse code in a web IDE, search semantically, and talk to a coding agent — all from the browser.

**User flow:**
1. Sign in with GitHub (OAuth)
2. Install GitHub App → select repos to grant access
3. Platform clones repo, indexes it (background)
4. User browses file tree in web IDE (left panel)
5. User searches code semantically (search bar)
6. User chats with coding agent (right panel) — agent has full codebase context
7. On every push to GitHub, platform re-indexes incrementally via Merkle diff

---

## 2. Architecture Overview

Three services, clean separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER (Next.js frontend)                │
│                                                              │
│  Dashboard │ Web IDE (file tree + editor) │ Chat sidebar     │
│  Auth UI   │ Search bar                   │ Agent progress   │
└──────┬──────────────┬────────────────────────┬──────────────┘
       │              │                        │
       │ REST/RSC     │ REST (files)           │ SSE (streaming)
       ▼              ▼                        ▼
┌──────────────┐ ┌──────────────────┐ ┌────────────────────────┐
│  Next.js     │ │  Hono API        │ │  Trigger.dev           │
│  (Vercel)    │ │  (Fly.io)       │ │  (Cloud)               │
│              │ │                  │ │                        │
│  - Auth      │ │  - Chat stream   │ │  - index-repo          │
│  - Dashboard │ │  - Agent stream  │ │  - sync-repo           │
│  - Webhooks  │ │  - Search API    │ │  - cleanup-repo        │
│  - File read │ │  - File read     │ │                        │
│  - Settings  │ │  - Conversation  │ │                        │
└──────┬───────┘ └────────┬─────────┘ └────────┬───────────────┘
       │                  │                     │
       ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                     SHARED DATA LAYER                        │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │  Neon    │  │  Qdrant  │  │  R2      │  │  GitHub API │ │
│  │ Postgres │  │  Cloud   │  │ (CF)     │  │  (App)      │ │
│  │          │  │          │  │          │  │             │ │
│  │ users    │  │ vectors  │  │ repo     │  │ clone/pull  │ │
│  │ repos    │  │ + chunk  │  │ tarballs │  │ webhooks    │ │
│  │ hashes   │  │ content  │  │          │  │ PRs         │ │
│  │ convos   │  │ in       │  │          │  │             │ │
│  │ jobs     │  │ payload  │  │          │  │             │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘ │
│                                                              │
│  ┌──────────────────┐  ┌────────────────────────────────┐   │
│  │  Grafana Cloud   │  │  Sentry                        │   │
│  │  (OTEL traces +  │  │  (error tracking + source maps)│   │
│  │   logs + metrics) │  │                                │   │
│  └──────────────────┘  └────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Why three services?

| Service | Why it exists | Deployment |
|---------|--------------|------------|
| **Next.js (Vercel)** | UI rendering, auth, GitHub webhook receiver, dashboard. Serverless — scales to zero, no cost when idle. | Vercel free tier |
| **Hono API (Fly.io)** | Chat/agent streaming, search API, file serving. Persistent server — no timeouts, direct SSE to client. Required because users stare at streaming responses. | Fly.io (~$5/mo) |
| **Trigger.dev** | Repo indexing, incremental sync, cleanup. Background jobs — fire and forget, retries, queues. | Trigger.dev Cloud (free tier) |

---

## 3. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Frontend** | Next.js 16 + React 19 + shadcn/ui + Tailwind v4 | Our existing design system (preset auFzGMc). SSR + RSC. Note: Next.js 16 renames `middleware.ts` → `proxy.ts` (nodejs runtime only, no edge). |
| **Auth** | Better Auth (GitHub OAuth provider) | OSS, stores tokens in our Postgres, progressive scope escalation, Auth.js team joined them. |
| **GitHub integration** | GitHub App (not just OAuth App) | Push webhooks, installation tokens (1hr, auto-rotated), fine-grained repo permissions. |
| **Chat/Agent API** | Hono + Vercel AI SDK 5 (stable) + Claude Agent SDK V1 | Hono: 14KB, native TS, built-in `streamSSE()`. AI SDK 5: `useChat` hook + `streamText()` + `@ai-sdk/anthropic` provider. Claude Agent SDK V1: `query()` with async iterable for custom tools + subagents. Note: AI SDK 6 and Agent SDK V2 are in beta — upgrade when stable. |
| **Background jobs** | Trigger.dev v3 | No timeouts, retries, queues, built-in observability. Deployed separately. |
| **Database** | Neon Postgres (serverless) | Free tier (100 CU-hrs/mo). Scales to zero. Drizzle ORM. |
| **Vector DB** | Qdrant Cloud | Already used in CLI. HNSW cosine. Chunk content stored in payload. |
| **Object storage** | Cloudflare R2 | S3-compatible. Zero egress fees. 10GB free. Repo tarballs + file serving. |
| **Embeddings** | OpenAI text-embedding-3-small (1536 dims) | Already used in CLI. Batched, cached by chunk hash. **Breaking change**: CLI also supports Voyage (1024-dim). Cloud standardizes on OpenAI only. Existing Voyage-indexed Qdrant collections are incompatible and must be re-indexed. |
| **LLM** | Claude (Opus/Sonnet via Anthropic API) | Agent SDK gives native tool use, subagents, context management. |
| **Observability** | OpenTelemetry → Grafana Cloud + Sentry | OTEL for traces/logs/metrics. Sentry for errors. Both have generous free tiers. |
| **DNS/CDN** | Cloudflare | Already using R2. Free plan for DNS + CDN. |

---

## 4. Authentication & GitHub Integration

### 4.1 Two-Layer Auth Model

**Layer 1: User Identity (Better Auth + GitHub OAuth)**
- User clicks "Sign in with GitHub"
- Better Auth handles OAuth flow with `user:email` scope
- User profile + access token stored in Postgres (encrypted via `encryptOAuthTokens`)
- Session managed via Better Auth (JWT or database sessions)

**Layer 2: Repo Access (GitHub App)**
- User clicks "Add Repository"
- Redirected to GitHub App installation page
- User selects which repos to grant access
- GitHub sends `installation` webhook → we store `installation_id` in Postgres
- For repo operations: generate installation access token (1hr, auto-rotated)

### 4.2 GitHub App Configuration

```yaml
name: CodeIndexer
description: Semantic code search and AI-powered code assistant

permissions:
  repository:
    contents: read        # Clone repos, read files
    metadata: read        # List repos, basic info
    pull_requests: write  # Create PRs (coding agent, future)

subscribe_to_events:
  - push                  # Re-index on code changes
  - installation          # Know when app installed/removed
  - installation_repositories  # Know when repos added/removed
```

### 4.3 Token Lifecycle

```
Sign in:
  OAuth token → stored in Postgres (Better Auth accounts table)
  Used for: user identity only, NOT repo operations

Repo operations:
  installation_id → generate short-lived installation token (1hr)
  Used for: git clone, git pull, GitHub API (file reads, PR creation)
  Auto-rotated: request new token when old one expires
  Scoped: only repos the user granted access to
```

---

## 5. Database Schema (Neon Postgres)

```sql
-- Better Auth manages these tables automatically:
-- user, session, account, verification

-- Our application tables:

CREATE TABLE repos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  -- GitHub metadata
  github_id         BIGINT NOT NULL,
  full_name         TEXT NOT NULL,          -- "HrushiBorhade/code-indexer"
  default_branch    TEXT NOT NULL DEFAULT 'main',
  installation_id   BIGINT NOT NULL,        -- GitHub App installation

  -- Indexing state
  status            TEXT NOT NULL DEFAULT 'pending',
                    -- pending | cloning | indexing | ready | error | stale
  last_indexed_at   TIMESTAMPTZ,
  last_commit_sha   TEXT,
  index_error       TEXT,

  -- Storage references
  r2_tar_key        TEXT,                   -- R2 object key for repo tarball
  -- (Removed qdrant_namespace — single collection with repo_id payload filter, see Section 6)

  -- Stats
  file_count        INTEGER DEFAULT 0,
  chunk_count       INTEGER DEFAULT 0,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(user_id, github_id)
);

-- Migrated from SQLite — same schema, now per-repo with repo_id FK
CREATE TABLE file_hashes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id     UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  file_path   TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(repo_id, file_path)
);

CREATE TABLE chunk_cache (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id     UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  chunk_hash  TEXT NOT NULL,
  qdrant_id   TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  line_start  INTEGER NOT NULL,
  line_end    INTEGER NOT NULL,

  UNIQUE(repo_id, chunk_hash)
);
CREATE INDEX idx_chunk_cache_repo_file ON chunk_cache(repo_id, file_path);

CREATE TABLE dir_hashes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id     UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  dir_path    TEXT NOT NULL,
  merkle_hash TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(repo_id, dir_path)
);

-- Chat / conversation state
CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id     UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,     -- 'user' | 'assistant' | 'tool'
  content         TEXT NOT NULL,
  tool_calls      JSONB,            -- tool call metadata if role='assistant'
  tool_results    JSONB,            -- tool results if role='tool'
  tokens_used     INTEGER,
  model           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_convo ON messages(conversation_id, created_at);

-- Background job tracking
CREATE TABLE index_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id     UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  trigger_run_id  TEXT,             -- Trigger.dev run ID
  status      TEXT NOT NULL DEFAULT 'pending',
                  -- pending | running | completed | failed
  trigger     TEXT NOT NULL,        -- 'manual' | 'webhook' | 'initial'
  commit_sha  TEXT,
  queued_sha  TEXT,                -- If a newer push arrives during a running job, store it here
  files_changed   INTEGER,
  chunks_embedded INTEGER,
  error       TEXT,
  started_at  TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 6. Qdrant Vector Storage

### 6.1 Multi-Tenancy Strategy

**One collection, payload-based filtering** (Qdrant recommended approach):

```
Collection: "code-indexer"
  ├── Vectors: 1536 dimensions (OpenAI text-embedding-3-small)
  ├── Distance: Cosine
  └── Payload per point:
        {
          "repo_id": "uuid",           // tenant filter
          "file_path": "src/auth.ts",   // relative path
          "line_start": 10,
          "line_end": 45,
          "language": "typescript",
          "chunk_hash": "sha256...",
          "content": "function verifyJWT(token: string) {\n  ..."  // NEW: actual code
        }
```

Search query always includes `repo_id` filter:
```json
{
  "vector": [0.023, -0.156, ...],
  "filter": {
    "must": [{ "key": "repo_id", "match": { "value": "<uuid>" } }]
  },
  "limit": 10,
  "with_payload": true
}
```

### 6.2 Why One Collection (Not Collection-Per-Repo)

- Qdrant Cloud limits: 1000 collections per cluster
- Payload-based filtering with indexed fields is fast (Qdrant builds payload index)
- Qdrant 1.16 tiered multitenancy: small repos share space, large repos auto-promoted to dedicated shards
- Simpler lifecycle: no collection create/delete per repo add/remove

**REQUIRED: Create payload index on `repo_id` during collection setup:**
```json
PUT /collections/code-indexer/index
{ "field_name": "repo_id", "field_schema": "keyword" }
```
Without this explicit index, payload filtering degrades linearly with collection size. Must be called once during `ensureCollection()`.

### 6.3 Content in Payload

Chunk content (50-200 lines of code) stored directly in Qdrant payload field `content`.
- Eliminates disk/R2 read at search time
- Search returns code immediately
- Typical overhead: 5-10MB per 50K-line repo (500 chunks × 10-20KB each)
- R2 is used for full-file access (web IDE), not search results

---

## 7. Cloudflare R2 Object Storage

### 7.1 Storage Layout

```
r2-bucket: codeindexer-repos
  ├── repos/{repo_id}/repo.tar.gz          # Full shallow clone, compressed
  ├── repos/{repo_id}/file-tree.json       # Cached directory structure
  └── repos/{repo_id}/files/{path}         # Individual files (optional, for fast reads)
```

### 7.2 Strategy: Tarball vs Individual Files

**Phase 1: Tarball only**
- On index: `git clone --depth 1` → `tar czf` → upload to R2
- On file read (web IDE): download tar, extract specific file, return
- Simple but slow for individual file reads (~200ms for extraction)

**Phase 2 (optimization): Exploded files**
- After cloning, also upload individual files to `repos/{repo_id}/files/{path}`
- Web IDE reads directly: `GET r2://repos/{repo_id}/files/src/auth.ts`
- File tree JSON pre-computed and cached for instant tree rendering
- Tarball kept for incremental sync (download → git pull → re-upload)

### 7.3 Cost Estimate

| Metric | Estimate | Cost |
|--------|----------|------|
| 100 repos × 50MB avg | 5 GB storage | Free (10GB free tier) |
| 10K file reads/day | Class B operations | Free (10M free/mo) |
| Egress | All reads | $0 (R2 = zero egress) |

---

## 8. Service Details

### 8.1 Next.js (Vercel)

**Responsibilities:**
- Server-side rendering (dashboard, web IDE shell, settings)
- Better Auth integration (sign in/out, session management)
- GitHub App webhook receiver (`POST /api/webhooks/github`)
- File reads from R2 (proxied for web IDE): `GET /api/files/[repoId]/[...path]`
- Dashboard API (list repos, repo status, job history)
- Server Actions (add repo, remove repo, trigger manual re-index)
- Static assets + CDN

**Key routes:**

```
/                           → Landing page
/login                      → Better Auth sign-in
/dashboard                  → Repo list + status
/dashboard/settings         → API keys, preferences
/repo/[repoId]             → Web IDE (file tree + editor + chat)
/api/auth/[...betterauth]  → Better Auth handlers
/api/webhooks/github        → GitHub push/installation webhooks
/api/files/[repoId]/[...path] → Proxy file from R2
/api/repos                  → CRUD repos
/api/repos/[repoId]/status → Index status + progress
```

**Does NOT handle:** Chat streaming, search queries, agent execution.

### 8.2 Hono API (Fly.io)

**Responsibilities:**
- Chat streaming (direct SSE to client)
- Search API (embed query → Qdrant → return results with code)
- Coding agent execution (multi-step tool use → stream progress)
- Conversation CRUD (load history, save messages)
- File reading from R2 (for agent tool use)

**Key routes:**

```
POST /chat                  → Stream chat response (SSE)
POST /search                → Hybrid search (semantic + grep-like)
GET  /conversations         → List conversations for a repo
GET  /conversations/:id     → Load conversation messages
POST /agent                 → Start coding agent task (SSE)
GET  /health                → Health check
```

**Stack:**
```typescript
// Hono server with Vercel AI SDK + Claude Agent SDK

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { cors } from 'hono/cors'

const app = new Hono()

// CORS: FRONTEND_URL must be exact production domain (e.g. https://codeindexer.dev), NEVER '*'
app.use('/*', cors({ origin: process.env.FRONTEND_URL }))

// Rate limiting: per-user token bucket (10 chat turns/min, 30 searches/min)
// Shipped from Phase 3 — not deferred to polish phase
app.use('/*', rateLimiter({ /* ... */ }))

app.post('/chat', async (c) => {
  // 1. Validate session (JWT from Better Auth)
  // 2. Verify repo ownership: repos.user_id = session.userId (CRITICAL — prevents cross-tenant access)
  // 3. Load conversation history from Postgres (last 20 messages or ~8K tokens)
  // 4. Embed user query → Qdrant search (filtered by repo_id)
  // 5. Build context from search results (content in payload)
  // 6. Claude API with tools + stream: true
  // 7. Pipe tokens directly to client via SSE
  // 8. Save assistant message to Postgres (enforce max content length: 100KB)
  return streamSSE(c, async (stream) => {
    // ... streaming logic
  })
})
```

**Agent tools available to Claude:**

```typescript
const tools = {
  search_code: {
    description: "Search the codebase semantically",
    parameters: { query: z.string() },
    execute: async ({ query }) => {
      // Embed → Qdrant → return top-K chunks with code
    }
  },
  read_file: {
    description: "Read a file from the repository",
    parameters: {
      path: z.string()
        .transform(sanitizePath)                          // Strip ../ and . segments
        .refine(p => !p.includes('..'), 'Path traversal') // Double-check after transform
    },
    execute: async ({ path }) => {
      // SECURITY: path is sanitized by Zod transform above.
      // Additionally, validate path exists in file-tree.json before reading.
      // This prevents prompt injection attacks where malicious code comments
      // trick the LLM into requesting paths outside the repo scope.
      // Read from R2: repos/{repoId}/files/{path}
    }
  },
  list_files: {
    description: "List files in a directory",
    parameters: { directory: z.string() },
    execute: async ({ directory }) => {
      // Read file-tree.json from R2, filter by directory
    }
  },
  // Future: edit_file, create_pr, run_command
}
```

**Auth between Next.js and Hono:**
- Better Auth generates JWT session tokens
- Frontend sends `Authorization: Bearer <token>` to Hono
- Hono verifies JWT signature (shared secret or public key)
- No cookie-based auth (cross-origin)

**Repo ownership check (CRITICAL — every endpoint):**
Every Hono endpoint that accepts a `repoId` must verify ownership before executing:
```typescript
const repo = await db.query.repos.findFirst({
  where: and(eq(repos.id, repoId), eq(repos.userId, session.userId))
})
if (!repo) return c.json({ error: 'Not found' }, 404)
```
This prevents cross-tenant data access even if a `repo_id` UUID is guessed.

### 8.3 Trigger.dev (Background Workers)

**Responsibilities:**
- Initial repo indexing (clone → walk → chunk → embed → store)
- Incremental re-indexing on push (pull → Merkle diff → re-embed changed)
- Repo cleanup on disconnect (delete from R2, Qdrant, Postgres)

**Tasks:**

```typescript
// trigger/index-repo.ts
export const indexRepo = task({
  id: "index-repo",
  retry: { maxAttempts: 3 },
  machine: { preset: "medium-1x" },  // 1 vCPU, 1GB RAM

  run: async ({ repoId }: { repoId: string }) => {
    // 1. Load repo metadata from Postgres
    // 2. Generate GitHub App installation token
    // 3. git clone --depth 1 to /tmp
    // 4. Walk files (walker.ts — existing code)
    // 5. Chunk files (chunker/ — existing code)
    // 6. Embed chunks (embedder.ts — existing code, batched)
    // 7. Upsert to Qdrant (content in payload)
    // 8. Persist file_hashes + dir_hashes to Postgres
    // 9. tar.gz → upload to R2
    // 10. Compute + upload file-tree.json to R2
    // 11. Update repo status in Postgres: "ready"
  }
})

// trigger/sync-repo.ts
export const syncRepo = task({
  id: "sync-repo",
  retry: { maxAttempts: 3 },

  run: async ({ repoId, commitSha }: { repoId: string; commitSha: string }) => {
    // NOTE: Tarballs do NOT include .git/ (too large, wasteful).
    // Instead of git pull, we do a fresh shallow clone and diff via Merkle state in Postgres.
    //
    // 1. Generate installation token for repo
    // 2. git clone --depth 1 to /tmp (fresh shallow clone)
    // 3. Walk files → hash files
    // 4. Read dir_hashes + file_hashes from Postgres (our Merkle state IS the diff source)
    // 5. computeChanges() — existing Merkle diff logic
    // 6. Only changed files: chunk → embed → upsert
    // 7. Delete removed chunks from Qdrant
    // 8. Persist updated hashes to Postgres
    // 9. tar.gz (no .git/) → upload to R2 (for web IDE file serving)
    // 10. Update file-tree.json in R2
    // 11. Update repo status: "ready", last_commit_sha
    //
    // Idempotency: skip if index_jobs already has a completed job for this commit_sha.
  }
})

// trigger/cleanup-repo.ts
export const cleanupRepo = task({
  id: "cleanup-repo",

  run: async ({ repoId }: { repoId: string }) => {
    // 1. Delete all points from Qdrant where repo_id = repoId
    // 2. Delete R2 objects: repos/{repoId}/*
    // 3. Delete from Postgres: file_hashes, chunk_cache, dir_hashes, index_jobs
    // 4. Delete repo record
  }
})

// ─── EMAIL & LIFECYCLE TASKS ───

// trigger/emails/welcome.ts
export const sendWelcomeEmail = task({
  id: "send-welcome-email",
  retry: { maxAttempts: 3 },

  run: async ({ userId }: { userId: string }) => {
    // 1. Load user from Postgres (name, email)
    // 2. Send welcome email via Resend
    //    - Template: React Email component
    //    - Content: "Welcome to CodeIndexer. Connect your first repo →"
    // 3. Schedule drip emails: day 1, 3, 7
  }
})

// trigger/emails/drip.ts
export const sendDripEmail = task({
  id: "send-drip-email",

  run: async ({ userId, day }: { userId: string; day: 1 | 3 | 7 }) => {
    // Day 1: "Have you tried searching your codebase?"
    // Day 3: "Your coding agent can explain any function"
    // Day 7: "Connect more repos to get the full picture"
    // Skip if user already performed the action (check Postgres)
  }
})

// trigger/emails/weekly-digest.ts
export const sendWeeklyDigest = task({
  id: "send-weekly-digest",

  run: async ({ userId }: { userId: string }) => {
    // 1. Aggregate usage from past week:
    //    - Repos indexed, searches made, chat turns, agent actions
    // 2. Send digest email via Resend
    // 3. Skip if user had zero activity (don't spam inactive users)
  }
})

// ─── SCHEDULED CRON TASKS ───

// trigger/crons/stale-repo-check.ts
export const checkStaleRepos = schedules.task({
  id: "check-stale-repos",
  cron: "0 0 * * 0",  // Every Sunday midnight

  run: async () => {
    // 1. Find repos where last_indexed_at < 90 days ago
    // 2. Mark status = "stale"
    // 3. Send email: "Your repo X hasn't been updated in 90 days. Archive it?"
    // 4. If stale for 180 days and no user action → auto-archive (free up Qdrant/R2)
  }
})

// trigger/crons/index-health.ts
export const verifyIndexHealth = schedules.task({
  id: "verify-index-health",
  cron: "0 6 * * *",  // Every day at 6am

  run: async () => {
    // 1. For each "ready" repo:
    //    - Count Qdrant points where repo_id = X
    //    - Count chunk_cache rows where repo_id = X
    //    - If mismatch > 5% → flag for re-index
    // 2. Check for orphaned R2 objects (repo deleted but files remain)
    // 3. Check for orphaned Qdrant points (repo deleted but vectors remain)
    // 4. Alert via Sentry/Grafana if issues found
  }
})

// trigger/crons/weekly-digests.ts
export const triggerWeeklyDigests = schedules.task({
  id: "trigger-weekly-digests",
  cron: "0 9 * * 1",  // Every Monday at 9am

  run: async () => {
    // 1. Load all active users (logged in within last 30 days)
    // 2. Batch trigger sendWeeklyDigest for each user
  }
})

// trigger/crons/usage-aggregation.ts
export const aggregateUsage = schedules.task({
  id: "aggregate-usage",
  cron: "0 0 * * *",  // Every midnight

  run: async () => {
    // 1. Count per-user: chat turns, search queries, chunks indexed today
    // 2. Write to usage_daily table (for billing, analytics, rate limit decisions)
    // 3. Check if any user exceeded soft limits → flag for notification
  }
})

// trigger/webhooks/replay-failed.ts
export const replayFailedWebhooks = schedules.task({
  id: "replay-failed-webhooks",
  cron: "*/30 * * * *",  // Every 30 minutes

  run: async () => {
    // 1. Find index_jobs with status = "failed" and created_at < 30 min ago
    // 2. Retry up to 3 times
    // 3. After 3 failures → alert, mark as permanently_failed
  }
})
```

### 8.3.2 Email Infrastructure

**Provider: Resend** ($0 for 100 emails/day, 3000/month on free tier)

Why Resend:
- React Email for templates (same JSX you already write)
- First-class Trigger.dev integration
- Generous free tier for early stage
- Simple API: `resend.emails.send({ to, subject, react: <WelcomeEmail /> })`

**Email templates (React Email):**
```
packages/email/
  ├── src/
  │   ├── welcome.tsx           # Welcome email
  │   ├── drip-day1.tsx         # "Try searching"
  │   ├── drip-day3.tsx         # "Meet the coding agent"
  │   ├── drip-day7.tsx         # "Connect more repos"
  │   ├── weekly-digest.tsx     # Usage summary
  │   ├── repo-stale.tsx        # "Your repo is stale"
  │   ├── index-failed.tsx      # "Indexing failed for X"
  │   └── layout.tsx            # Shared email layout
  └── package.json
```

### 8.3.3 Complete Trigger.dev Task Registry

| Task | Trigger | When |
|------|---------|------|
| `index-repo` | Manual / webhook | User adds repo or initial install |
| `sync-repo` | GitHub push webhook | Code pushed to repo |
| `cleanup-repo` | Manual | User disconnects repo |
| `send-welcome-email` | User signup event | Immediately after signup |
| `send-drip-email` | Scheduled by welcome task | Day 1, 3, 7 after signup |
| `send-weekly-digest` | Cron (Monday 9am) | Weekly for active users |
| `check-stale-repos` | Cron (Sunday midnight) | Weekly |
| `verify-index-health` | Cron (daily 6am) | Daily |
| `aggregate-usage` | Cron (daily midnight) | Daily |
| `replay-failed-webhooks` | Cron (every 30min) | Continuous |

---

## 9. Core Flows

### 9.1 User Onboarding

```
User visits codeindexer.dev
  ↓
"Sign in with GitHub" (Better Auth, user:email scope)
  ↓
Dashboard (empty state — no repos)
  ↓
"Add Repository" → redirects to GitHub App install page
  ↓
User selects repos to grant access → GitHub sends installation webhook
  ↓
Webhook handler (user mapping):
  - Webhook payload contains installation.account.id (GitHub user/org ID)
  - Match this to the github_id in Better Auth's `account` table → find our user_id
  - If no match (edge case): store pending installation, resolve when user returns to dashboard
  - Stores installation_id in Postgres linked to the resolved user_id
  - Creates repo records for each selected repo
  - Triggers index-repo task for each repo via Trigger.dev
  ↓
Dashboard shows repos with "Indexing..." status
  ↓
Trigger.dev worker clones, indexes, uploads to R2
  ↓
Repo status flips to "Ready"
  ↓
User clicks repo → Web IDE + Chat unlocked
```

### 9.2 Search Flow

```
User types query in search bar → "how does JWT verification work"
  ↓
Frontend: POST https://api.codeindexer.dev/search
  { query: "how does JWT verification work", repoId: "..." }
  ↓
Hono API:
  1. Validate session + repo ownership
  2. Guard: if repo.status !== 'ready', return { error: 'Repository not ready', status: repo.status }
  3. Embed query via OpenAI API (~100ms)
  4. Qdrant search with repo_id filter (~50ms)
  5. Return top-K results with code from payload
  ↓
Frontend renders search results with code snippets
  Total latency: ~200-400ms
```

### 9.3 Chat Flow

```
User types: "Explain the auth middleware and how it handles expired tokens"
  ↓
Frontend (Vercel AI SDK useChat):
  POST https://api.codeindexer.dev/chat (Accept: text/event-stream)
  { message, repoId, conversationId }
  ↓
Hono API:
  1. Validate session + repo ownership
  2. Guard: if repo.status !== 'ready', return { error: 'Repository not ready', status: repo.status }
  3. Load last 20 messages from Postgres (conversation history, ~8K token budget)
  4. Embed user query → Qdrant hybrid search
  4. Build system prompt with search results as context
  5. Call Claude API (stream: true, tools: [search_code, read_file, list_files])
  ↓
Claude streams response:
  Token: "The" → SSE → Client
  Token: " auth" → SSE → Client
  Token: " middleware" → SSE → Client
  ...
  Tool call: search_code("token expiry handling")
    → Execute search → feed results back to Claude
  Claude continues streaming with additional context
  ...
  Token: "[done]"
  ↓
Hono saves assistant message to Postgres
Frontend shows complete response
```

### 9.4 Re-Index on Push

```
Developer pushes commit to GitHub
  ↓
GitHub sends push webhook to:
  POST https://codeindexer.dev/api/webhooks/github
  Headers: X-GitHub-Event: push, X-Hub-Signature-256: sha256=...
  Body: { ref, commits, repository, installation, ... }
  ↓
Next.js webhook handler:
  1. Verify webhook signature (HMAC SHA-256)
  2. Extract repo full_name + commit SHA
  3. Look up repo in Postgres
  4. Deduplicate: skip if index_job already exists for this (repo_id, commit_sha)
  5. Debounce: if a sync is already running for this repo, update its queued_sha instead
  6. Create index_job record (UNIQUE(repo_id, commit_sha) prevents duplicates)
  7. Trigger sync-repo task via Trigger.dev
  ↓
Trigger.dev sync-repo worker:
  1. Guard: if repo.status = 'indexing' (initial index running), queue commit_sha and skip
  2. Generate installation token for this repo
  3. git clone --depth 1 to /tmp (fresh shallow clone — tarballs have NO .git/)
  4. Hash files → read Merkle state from Postgres → computeChanges()
  5. Re-embed only changed files → upsert to Qdrant
  6. Delete removed chunks from Qdrant
  7. Persist updated hashes to Postgres
  8. Re-tar → upload to R2 + update file-tree.json
  9. If repo.status was 'ready', check for queued_sha → trigger another sync if present
  ↓
Repo status: "ready" with new last_commit_sha
User sees updated index on next search/chat
```

### 9.5 Web IDE File Browsing

```
User clicks repo → /repo/[repoId]
  ↓
Next.js loads repo metadata + initial file tree from R2 (file-tree.json)
  ↓
Left panel: File tree rendered (directory structure)
Right panel: Chat sidebar
Center: Empty editor state
  ↓
User clicks "src/auth.ts" in file tree
  ↓
Frontend: GET /api/files/[repoId]/src/auth.ts
  ↓
Next.js API route:
  1. Validate session + repo ownership
  2. Read file from R2: repos/{repoId}/files/src/auth.ts
  3. Return file content with language detection
  ↓
Center panel: Code rendered with syntax highlighting (Monaco or CodeMirror)
```

---

## 10. Observability

### 10.1 Stack

**Frontend (Next.js on Vercel):**

| Tool | Purpose | Free tier |
|------|---------|-----------|
| **@vercel/otel** | Automatic route tracing, server component spans | Included with Vercel |
| **Vercel Analytics** | Web Vitals (LCP, FID, CLS), page views, navigation timing | 2.5K events/mo free |
| **PostHog** | Product analytics, feature flags, A/B testing, funnels, user paths | 1M events/mo free |
| **Microsoft Clarity** | Session recordings, heatmaps, dead click detection, rage click detection | Unlimited free |
| **Sentry** | Error tracking + source maps + performance monitoring | 5K events/mo free |

**API + Workers (Hono on Fly.io, Trigger.dev):**

| Tool | Purpose | Free tier |
|------|---------|-----------|
| **OpenTelemetry → Grafana Tempo** | Distributed traces (request → embed → Qdrant → Claude → response) | 50GB/mo |
| **OpenTelemetry → Grafana Loki** | Structured logs (JSON, correlated with trace IDs) | 50GB/mo |
| **OpenTelemetry → Grafana Prometheus** | Metrics (latency histograms, request counts, error rates) | 10K series |
| **Sentry** | Error tracking + stack traces | 5K events/mo (shared with frontend) |
| **Better Stack / UptimeRobot** | Uptime monitoring + status page | 50 monitors free |

### 10.2 What to Instrument

**Next.js (Vercel) — Frontend:**
- `@vercel/otel` — automatic route + RSC tracing
- Vercel Analytics — Core Web Vitals, page load performance
- PostHog — product analytics, feature flags, A/B testing, funnels, user paths
- Microsoft Clarity — session replays for UX debugging (how users interact with web IDE, chat)
- Sentry — error tracking with source maps, replay integration
- Custom spans: webhook processing time, R2 file proxy latency

**Hono API (Fly.io) — Backend:**
- OpenTelemetry Node.js SDK (`@opentelemetry/sdk-node`)
- Custom spans: embed latency, Qdrant search latency, Claude API latency, tool call duration
- Per-chat-turn metrics: tokens used, tool calls made, total latency, time-to-first-token
- Request-level traces: correlate frontend request → API → Qdrant → Claude → response
- Sentry for unhandled errors

**Trigger.dev — Workers:**
- Built-in observability (traces, logs, duration per run)
- Custom metrics: indexing duration, files processed, chunks embedded, R2 upload time
- Alert on: failed runs, runs exceeding 10 minutes, Qdrant upsert failures

### 10.3 Key Dashboards

1. **Search performance**: p50/p95/p99 latency, queries/min, Qdrant hit rate
2. **Chat performance**: time-to-first-token, tokens/sec, tool calls/turn
3. **Indexing health**: jobs/day, success rate, avg duration, files/chunks processed
4. **System health**: API error rates, R2 read latency, Postgres query latency

---

## 11. Security

### 11.1 Authentication & Authorization Model

There are three distinct security boundaries in the system:

**Boundary 1: Who is this user? (Authentication)**
- Next.js: Better Auth cookie-based sessions (same-origin, httpOnly, secure)
- Hono: JWT Bearer tokens issued by Better Auth (cross-origin)
- Trigger.dev: Server-side only, no user context needed (API key auth)

**Boundary 2: Can this user access this repo? (Authorization)**
- Every request that touches repo data must verify ownership
- This is enforced via middleware, not per-route manual checks

**Boundary 3: Can this user perform this action? (Rate limiting)**
- Per-user rate limits on expensive operations (chat, search, indexing)

### 11.2 Middleware Enforcement (Hono)

Security is enforced via Hono middleware — not by trusting each route handler to check manually:

```typescript
// apps/api/src/middleware/auth.ts
import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'

// Middleware 1: Authenticate — extract and verify JWT, attach user to context
export const authenticate = createMiddleware(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing authorization' }, 401)
  }

  const token = header.slice(7)
  try {
    const payload = await verify(token, process.env.JWT_SECRET!)
    c.set('userId', payload.sub as string)
    c.set('userEmail', payload.email as string)
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  await next()
})

// Middleware 2: Authorize repo — verify user owns the repo in the request
// NOTE: Only reads repoId from URL param, NEVER from body (body can only be consumed once in Hono)
export const authorizeRepo = createMiddleware(async (c, next) => {
  const repoId = c.req.param('repoId')
  const userId = c.get('userId')

  if (!repoId) {
    return c.json({ error: 'Missing repoId' }, 400)
  }

  const repo = await db.query.repos.findFirst({
    where: and(eq(repos.id, repoId), eq(repos.userId, userId))
  })

  if (!repo) {
    // Return 404 not 403 — don't reveal that the repo exists for another user
    return c.json({ error: 'Repository not found' }, 404)
  }

  c.set('repo', repo)
  await next()
})

// Middleware 3: Rate limit — per-user token bucket
export const rateLimit = (limit: number, windowMs: number) =>
  createMiddleware(async (c, next) => {
    const userId = c.get('userId')
    const key = `rate:${userId}:${c.req.path}`

    // In-memory for v1, move to Redis if scaling beyond single instance
    const now = Date.now()
    const window = rateBuckets.get(key) || { count: 0, start: now }

    if (now - window.start > windowMs) {
      window.count = 0
      window.start = now
    }

    if (window.count >= limit) {
      return c.json({ error: 'Rate limit exceeded' }, 429)
    }

    window.count++
    rateBuckets.set(key, window)
    await next()
  })
```

**Applied to routes:**

```typescript
// apps/api/src/index.ts
const app = new Hono()

// Global middleware
app.use('/*', cors({ origin: process.env.FRONTEND_URL }))

// All routes except /health require authentication
app.use('/chat/*', authenticate, authorizeRepo, rateLimit(20, 60_000))
app.use('/search/*', authenticate, authorizeRepo, rateLimit(60, 60_000))
app.use('/agent/*', authenticate, authorizeRepo, rateLimit(5, 60_000))
app.use('/conversations/*', authenticate)

// Routes
app.post('/chat/:repoId', chatHandler)       // userId + repo already verified
app.post('/search/:repoId', searchHandler)    // userId + repo already verified
app.post('/agent/:repoId', agentHandler)      // userId + repo already verified
app.get('/conversations', listConversations)  // userId verified, queries by userId
app.get('/health', (c) => c.json({ ok: true }))
```

**Key principle: By the time a route handler executes, auth + authz are already done.** The handler can trust `c.get('userId')` and `c.get('repo')` — no manual checks needed.

### 11.3 Middleware Enforcement (Next.js)

```typescript
// apps/web/proxy.ts (Next.js 16 renamed middleware.ts → proxy.ts)
// Runtime is exclusively 'nodejs' (not edge) in Next.js 16+
import { NextRequest, NextResponse } from 'next/server'
import { decrypt } from '@/lib/session'
import { cookies } from 'next/headers'

const protectedRoutes = ['/dashboard', '/repo']
const publicRoutes = ['/login', '/', '/api/webhooks/github']

export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname
  const isProtectedRoute = protectedRoutes.some(r => path.startsWith(r))
  const isPublicRoute = publicRoutes.some(r => path.startsWith(r))

  const cookie = (await cookies()).get('session')?.value
  const session = await decrypt(cookie)

  if (isProtectedRoute && !session?.userId) {
    return NextResponse.redirect(new URL('/login', req.nextUrl))
  }

  if (isPublicRoute && session?.userId && !path.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/dashboard', req.nextUrl))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|.*\\.png$).*)']
}

// For API routes that touch repo data:
// apps/web/app/api/files/[repoId]/[...path]/route.ts
export async function GET(req, { params }) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const repo = await db.query.repos.findFirst({
    where: and(eq(repos.id, params.repoId), eq(repos.userId, session.user.id))
  })
  if (!repo) return new Response('Not found', { status: 404 })

  // Safe: user owns this repo
  const file = await r2.get(`repos/${repo.id}/files/${params.path.join('/')}`)
  return new Response(file.body)
}
```

### 11.4 Data Isolation (Defense in Depth)

Three layers ensure no cross-tenant data access:

| Layer | Enforcement | What it prevents |
|-------|------------|-----------------|
| **1. Middleware** | JWT auth + repo ownership check | Unauthenticated access, accessing other users' repos |
| **2. Query scoping** | Every Postgres query includes `user_id` or `repo_id` WHERE clause. Every Qdrant query includes `repo_id` filter. Every R2 key prefixed with `repo_id`. | SQL injection or query bugs leaking data |
| **3. Postgres RLS (optional, Phase 5)** | `ALTER TABLE repos ENABLE ROW LEVEL SECURITY; CREATE POLICY ... USING (user_id = current_setting('app.user_id'))` | Defense against bugs in query scoping — DB enforces isolation even if app code is wrong |

**R2 access control:**
- R2 bucket is private (no public access)
- Only Next.js and Hono servers have S3 access keys
- R2 keys structured as `repos/{repoId}/...` — the `repoId` in the key matches the authorized `repoId` from middleware
- Path traversal prevention: strip `../` from user-supplied file paths before constructing R2 keys

```typescript
// Prevent path traversal in file reads
function sanitizePath(userPath: string): string {
  return userPath
    .split('/')
    .filter(segment => segment !== '..' && segment !== '.' && segment !== '')
    .join('/')
}
```

### 11.5 Secrets Management

| Secret | Stored in | Accessed by |
|--------|----------|-------------|
| GitHub App private key (.pem) | Vercel env vars (encrypted) | Next.js (webhook handler, token generation) |
| GitHub App webhook secret | Vercel env vars | Next.js (webhook verification) |
| Better Auth JWT secret | Vercel + Fly.io env vars | Next.js (sign), Hono (verify) |
| OpenAI API key | Fly.io + Trigger.dev env vars | Hono (embed queries), Workers (embed chunks) |
| Qdrant API key | Fly.io + Trigger.dev env vars | Hono (search), Workers (upsert) |
| R2 access key + secret | Vercel + Fly.io + Trigger.dev env vars | All three (file reads/writes) |
| Neon Postgres connection string | Vercel + Fly.io + Trigger.dev env vars | All three (DB queries) |
| Sentry DSN | Vercel + Fly.io env vars | Next.js, Hono (error reporting) |
| Resend API key | Trigger.dev env vars | Workers (email sending) |

**Rules:**
- No secrets in code, Git, R2, or Postgres
- All secrets encrypted at rest in their respective platforms
- Rotate GitHub App private key annually
- Better Auth JWT secret: 256-bit random, rotated on breach
- `.env.example` documents all required keys without values

### 11.6 Webhook Verification

```typescript
// /api/webhooks/github — MUST verify before processing
import { createHmac, timingSafeEqual } from 'crypto'

function verifyGitHubWebhook(body: string, signature: string, secret: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  // timingSafeEqual prevents timing attacks
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

// In the route handler:
export async function POST(req: Request) {
  const body = await req.text()
  const signature = req.headers.get('X-Hub-Signature-256')

  if (!signature || !verifyGitHubWebhook(body, signature, WEBHOOK_SECRET)) {
    return new Response('Invalid signature', { status: 401 })
  }

  // Safe: webhook is genuine from GitHub
  const event = req.headers.get('X-GitHub-Event')
  const payload = JSON.parse(body)
  // ... process webhook
}
```

### 11.7 Input Validation

All user inputs validated with Zod before processing:

```typescript
// Hono route input validation
const chatSchema = z.object({
  message: z.string().min(1).max(10_000),       // Max 10K chars per message
  repoId: z.string().uuid(),                     // Must be valid UUID
  conversationId: z.string().uuid().optional(),   // Optional, must be UUID if present
})

const searchSchema = z.object({
  query: z.string().min(1).max(1_000),            // Max 1K chars
  repoId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(10),
})

// In route handler:
app.post('/search/:repoId', async (c) => {
  const body = searchSchema.safeParse(await c.req.json())
  if (!body.success) return c.json({ error: body.error.flatten() }, 400)
  // ... proceed with validated data
})
```

### 11.8 Auth Between Services

```
Browser → Next.js:  Cookie-based session (Better Auth, same origin, httpOnly, secure, SameSite=Lax)
Browser → Hono:     JWT Bearer token (cross-origin, short-lived, RS256 asymmetric — verified with public key only)
Next.js → Trigger:  Trigger.dev SDK (API key, server-side only, never sent to client)
Hono → Qdrant:      API key in header (server-side only)
Hono → R2:          S3 v4 signature (server-side only)
Workers → GitHub:   Installation token (1hr TTL, auto-rotated, scoped to specific repos)
Workers → Resend:   API key (server-side only)
```

**JWT token flow (Better Auth → Hono):**
```
1. User logs in via Better Auth → session created in Postgres
2. Frontend calls Next.js API: GET /api/auth/token
3. Next.js verifies session cookie, mints short-lived JWT (15min)
   → payload: { sub: userId, email, iss: "codeindexer-web", aud: "codeindexer-api", iat, exp }
   → signed with RS256 PRIVATE key (only Next.js holds this)
4. Frontend stores JWT in memory (NOT localStorage — XSS risk)
5. Frontend sends to Hono: Authorization: Bearer <jwt>
6. Hono verifies RS256 signature with PUBLIC key + checks aud === "codeindexer-api"
   → Hono CANNOT forge tokens (only has public key)
7. Frontend refreshes JWT before expiry via same Next.js endpoint
   → Refresh always re-validates session cookie, never trusts the expiring JWT itself
8. For long-running SSE streams (chat/agent): JWT validated at stream initiation only.
   Stream stays authorized for its full duration regardless of token expiry.
```

---

## 12. Monorepo Structure

```
codeindexer/
├── apps/
│   ├── web/                    # Next.js frontend (Vercel)
│   │   ├── app/
│   │   │   ├── (auth)/         # Login, signup pages
│   │   │   ├── dashboard/      # Repo list, settings
│   │   │   ├── repo/[repoId]/  # Web IDE
│   │   │   └── api/
│   │   │       ├── auth/[...betterauth]/
│   │   │       ├── webhooks/github/
│   │   │       ├── files/[repoId]/[...path]/
│   │   │       └── repos/
│   │   ├── components/         # UI components (shadcn)
│   │   ├── lib/
│   │   │   ├── auth.ts         # Better Auth config
│   │   │   ├── db.ts           # Drizzle client
│   │   │   └── r2.ts           # R2 client
│   │   └── package.json
│   │
│   ├── api/                    # Hono chat/agent server (Fly.io)
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── chat.ts     # POST /chat (SSE streaming)
│   │   │   │   ├── search.ts   # POST /search
│   │   │   │   ├── agent.ts    # POST /agent (coding agent)
│   │   │   │   └── conversations.ts
│   │   │   ├── lib/
│   │   │   │   ├── auth.ts     # JWT verification
│   │   │   │   ├── qdrant.ts   # Search client
│   │   │   │   ├── r2.ts       # File reading
│   │   │   │   └── claude.ts   # Agent SDK setup
│   │   │   ├── tools/          # Agent tools
│   │   │   │   ├── search-code.ts
│   │   │   │   ├── read-file.ts
│   │   │   │   └── list-files.ts
│   │   │   └── index.ts        # Hono app entry
│   │   └── package.json
│   │
│   └── trigger/                # Trigger.dev worker
│       ├── src/
│       │   ├── tasks/
│       │   │   ├── index-repo.ts
│       │   │   ├── sync-repo.ts
│       │   │   └── cleanup-repo.ts
│       │   ├── emails/
│       │   │   ├── welcome.ts
│       │   │   ├── drip.ts
│       │   │   └── weekly-digest.ts
│       │   ├── crons/
│       │   │   ├── stale-repo-check.ts
│       │   │   ├── index-health.ts
│       │   │   ├── usage-aggregation.ts
│       │   │   └── replay-failed-webhooks.ts
│       │   └── trigger.config.ts
│       └── package.json
│
├── packages/
│   ├── core/                   # Shared pipeline code (from current CLI)
│   │   ├── src/
│   │   │   ├── chunker/        # AST chunking (existing)
│   │   │   ├── lib/
│   │   │   │   ├── walker.ts   # File discovery (existing)
│   │   │   │   ├── embedder.ts # Embedding (existing)
│   │   │   │   ├── hash.ts     # SHA-256 (existing)
│   │   │   │   ├── store.ts    # Qdrant client (existing, modified)
│   │   │   │   ├── search.ts   # Search (existing)
│   │   │   │   ├── grep.ts     # Ripgrep (existing)
│   │   │   │   ├── merge.ts    # RRF fusion (existing)
│   │   │   │   └── sync.ts     # Merkle diff (existing, reads from Postgres)
│   │   │   └── languages.ts    # Language map (existing)
│   │   └── package.json
│   │
│   ├── db/                     # Drizzle schema + migrations
│   │   ├── src/
│   │   │   ├── schema.ts       # All table definitions
│   │   │   ├── client.ts       # Drizzle + Neon client
│   │   │   └── migrate.ts      # Migration runner
│   │   ├── drizzle/            # Migration files
│   │   └── package.json
│   │
│   ├── email/                  # React Email templates
│   │   ├── src/
│   │   │   ├── welcome.tsx
│   │   │   ├── drip-day1.tsx
│   │   │   ├── drip-day3.tsx
│   │   │   ├── drip-day7.tsx
│   │   │   ├── weekly-digest.tsx
│   │   │   ├── repo-stale.tsx
│   │   │   ├── index-failed.tsx
│   │   │   └── layout.tsx      # Shared email layout (CodeIndexer branding)
│   │   └── package.json
│   │
│   └── config/                 # Shared config (env validation, constants)
│       ├── src/
│       │   ├── env.ts          # Zod env schema
│       │   └── constants.ts    # Collection names, bucket names, etc.
│       └── package.json
│
├── turbo.json                  # Turborepo config
├── package.json                # Root (workspaces)
├── .env.example
└── CLAUDE.md
```

### Key decision: Monorepo with Turborepo

- **packages/core** = existing CLI pipeline code, now importable as a library
- **packages/db** = shared Drizzle schema, used by all three services
- **packages/config** = shared env validation, used by all three services
- Each app has its own `package.json` and deploy pipeline
- Turborepo handles build caching and task orchestration

---

## 13. Migration Path (CLI → Cloud)

The existing CLI code in `src/` becomes `packages/core/`. Changes needed:

| Current (CLI) | Cloud (packages/core) | Change | Effort |
|---|---|---|---|
| `db.ts` uses better-sqlite3 (sync API) | Replaced by `packages/db` (Drizzle + Neon, async API) | **Delete `db.ts` entirely.** All query functions move to `packages/db`. Every caller must switch from sync to async. | High |
| `sync.ts` uses `db.transaction(() => {})()` (sync) | `sync.ts` uses `db.transaction(async (tx) => {})` (async Drizzle) | **Significant refactor.** Extract pure Merkle logic (`buildMerkleTree`, `computeChanges` diffing) into pure functions. Create `SyncStorage` interface for DB I/O. Implement with Drizzle. All transaction code rewritten to async. | High |
| `store.ts` — no content in payload, no repo_id filter | `store.ts` — `content` + `repo_id` in payload. `searchPoints()` accepts `repoId` filter param. | Add `content: string` and `repo_id: string` to `PointPayload`. Add `repo_id` filter to all search/delete operations. Create `ScopedQdrantClient` wrapper that always injects `repo_id`. | Medium |
| `search.ts` reads code from disk via `fs.readFile()` | `search.ts` reads code from Qdrant payload `content` field | **Remove `readCodeSnippet()` entirely.** Extract code from Qdrant search response payload. No more filesystem dependency. | Medium |
| `embedder.ts` — unchanged | Same | No change | None |
| `walker.ts` — uses git ls-files | Same (worker has a real git clone in /tmp) | No change | None |
| `chunker/` — uses native `tree-sitter` (C++ N-API) | **Switch to `web-tree-sitter` (WASM)** for cloud. Native tree-sitter is built for darwin-arm64 and will fail in Linux containers (Trigger.dev workers). WASM is platform-independent. | **Critical migration.** Requires: `npm install web-tree-sitter`, load `.wasm` grammar files instead of native `.node` addons, async init (`await Parser.init()`). API is slightly different (async vs sync). | High |
| `grep.ts` — local ripgrep | **Replaced by Qdrant BM25 full-text search** on `content` payload field | Remove `grep.ts` from `packages/core` (or keep as CLI-only, do not export). New `textSearch()` function queries Qdrant's full-text index. `merge.ts` RRF logic unchanged — just receives results from two Qdrant queries instead of Qdrant + ripgrep. | Medium |
| `merge.ts` — RRF fusion | Same (receives two result arrays, merges) | No change to algorithm. Input source changes. | None |
| `index.ts` — CLI entrypoint | Removed (replaced by Trigger.dev tasks in `apps/trigger/`) | Entry point deleted | N/A |

**Core principle: The Merkle algorithm and chunking logic stay the same. The I/O boundaries (DB, filesystem, search) are the significant refactors.**

### packages/config env validation

The current `env.ts` uses a single Zod schema with `process.exit(1)` on failure. In the cloud, each service needs different env vars. Solution:

```typescript
// packages/config/src/env.ts
export const baseEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
})

// apps/web uses:    baseEnv.extend({ GITHUB_APP_PRIVATE_KEY: z.string(), ... })
// apps/api uses:    baseEnv.extend({ JWT_PUBLIC_KEY: z.string(), OPENAI_API_KEY: z.string(), ... })
// apps/trigger uses: baseEnv.extend({ OPENAI_API_KEY: z.string(), R2_ACCESS_KEY: z.string(), ... })
```

---

## 14. Build Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Set up monorepo (Turborepo, packages/core, packages/db, packages/config)
- [ ] Migrate existing CLI code to packages/core
- [ ] Set up Neon Postgres + Drizzle schema + migrations
- [ ] Set up Better Auth with GitHub OAuth in Next.js
- [ ] Basic dashboard UI (repo list, empty states)
- [ ] GitHub App creation + installation webhook handler

### Phase 2: Indexing Pipeline (Week 3-4)
- [ ] **Switch chunker/ from native tree-sitter to web-tree-sitter (WASM)** — CRITICAL for Trigger.dev Linux workers
- [ ] Refactor sync.ts: extract pure Merkle logic, create SyncStorage interface, implement async Drizzle version
- [ ] Set up Trigger.dev with index-repo task
- [ ] Clone repo using installation token → chunk → embed → Qdrant (with content + repo_id in payload)
- [ ] Create Qdrant payload index on `repo_id` field during ensureCollection()
- [ ] Persist Merkle state to Postgres (via SyncStorage interface)
- [ ] Upload repo tarball + exploded files + file-tree.json to R2
- [ ] Dashboard shows indexing progress (Trigger.dev useRealtimeRun hook or polling)
- [ ] Push webhook → sync-repo task (fresh clone → Merkle diff → incremental re-embed)
- [ ] Guard: concurrent index + sync race condition (queue SHA if initial index running)

### Phase 3: Search + Web IDE (Week 5-6)
- [ ] Hono API server setup on Fly.io
- [ ] JWT auth: RS256 asymmetric (Next.js signs with private key, Hono verifies with public key)
- [ ] JWT claims: iss, aud, sub, email, exp
- [ ] **Rate limiting on Hono from day one** (20 chat/min, 60 search/min per user)
- [ ] Search endpoint (embed → Qdrant vector + BM25 full-text → RRF merge → return code from payload)
- [ ] Guard: return error if repo.status !== 'ready'
- [ ] File serving from R2 (web IDE file reads, path sanitization)
- [ ] Web IDE UI: file tree (left) + code viewer (center)
- [ ] Search bar in web IDE

### Phase 4: Chat Agent (Week 7-8)
- [ ] Chat endpoint with SSE streaming (direct, not via Trigger.dev)
- [ ] Vercel AI SDK useChat integration in frontend
- [ ] Claude API with tool use (search_code, read_file with path sanitization, list_files)
- [ ] Conversation persistence in Postgres (last 20 messages context window)
- [ ] Chat UI (right sidebar in web IDE)
- [ ] **Global cost circuit breaker** — daily spend cap on Claude API, pause chat if exceeded

### Phase 5: Observability + Polish (Week 9-10)
- [ ] Sentry error tracking (do this first — 5 min setup, high value)
- [ ] Global error handler: sanitize error responses (never leak internals to client)
- [ ] OpenTelemetry instrumentation (Hono + Next.js) → Grafana Cloud (defer if tight on time)
- [ ] Cleanup-repo task + repo deletion flow (set status='deleting' before cleanup)
- [ ] Edge cases: webhook replay protection (store X-GitHub-Delivery IDs), failed indexing recovery
- [ ] Email infrastructure: welcome email via Resend (defer drip/digest to later)
- [ ] Cron tasks: stale repo check, index health verification (defer to Phase 5+)

### Phase 6: Coding Agent (Future)
- [ ] Claude Agent SDK integration for multi-step editing
- [ ] Propose changes → diff view → user approval
- [ ] Create PR via GitHub App installation token
- [ ] Agent memory (learn from past conversations)

---

## 15. Cost Estimate (Early Stage — <100 users)

| Service | Tier | Monthly cost | First paid upgrade trigger |
|---------|------|-------------|--------------------------|
| Vercel | Free tier | $0 | Bandwidth >100GB → Hobby $20/mo |
| Fly.io | ~$5/mo | $5 | Fixed |
| Trigger.dev | Free ($5 included) | $0 | >$5 compute → Hobby $30/mo (~200 repos with regular syncs) |
| Neon Postgres | Free (100 CU-hrs, 500MB) | $0 | Storage >500MB → Launch $19/mo (~100 repos with active chat) |
| Qdrant Cloud | Free (1GB) | $0 | >1GB → paid cluster $25+/mo (~100-200 repos with content in payload) |
| Cloudflare R2 | Free (10GB, zero egress) | $0 | Storage >10GB (~200 repos) |
| OpenAI Embeddings | ~$0.02/1M tokens | ~$1-3 | Scales linearly, stays cheap |
| Claude API | Usage-based | ~$10-50 | **Dominant cost.** ~$0.03/chat turn (Sonnet). 1000 turns/day = $30/mo. Needs circuit breaker. |
| Resend | Free (3000 emails/mo) | $0 | >3000 emails → $20/mo |
| Grafana Cloud | Free tier | $0 | Deferred to Phase 5 |
| Sentry | Free (5K events/mo) | $0 | Very generous for early stage |
| **Total (launch)** | | **~$16-58/mo** | |
| **Total (100 active users)** | | **~$60-150/mo** | Qdrant + Claude API dominate |

---

## 16. Decided Questions (Formerly Open)

1. **Grep in cloud** — DECIDED: **Qdrant BM25 full-text search** on `content` payload field.
   Ripgrep can't run against R2. Content is already stored in Qdrant payload.
   Enable Qdrant's full-text index, run BM25 + vector search in parallel, merge with same RRF fusion.
   `merge.ts` logic stays identical — just receives results from two Qdrant queries instead of Qdrant + ripgrep.

2. **File-level caching in R2** — DECIDED: **Exploded files from day one.**
   Web IDE needs sub-100ms file reads. Tarball extraction per click is unusable.
   Indexing worker already walks every file — uploading each to `repos/{repoId}/files/{path}` costs nothing extra.
   Keep tarball too (for backup/bulk), but serve individual files for web IDE.

3. **Chat model selection** — DECIDED: **Default Sonnet, opt-in Opus.**
   Sonnet for everyday chat (~2s first token, cheaper).
   Opus for complex reasoning ("refactor this entire module").
   Model selector in chat UI, same as Claude.ai.

4. **Rate limiting strategy** — DECIDED: **Per-user token bucket, shipped from Phase 3.**
   Chat: 20 turns/min. Search: 60 req/min. Agent: 5 concurrent. Indexing: 5 concurrent repos.
   In-memory for v1 (single Fly.io instance). Move to Redis if scaling beyond one instance.

5. **Multi-branch support** — DECIDED: **Default branch only for v1.**
   Multi-branch = separate index per branch, multiplied storage, complex UI.
   Ship single-branch. Add branch switching when users ask for it.

### Remaining Open Questions

1. **Code editor component**: Monaco Editor (VS Code's editor, heavy) vs CodeMirror 6 (lighter, more customizable)?
2. **Conversation context window**: How many tokens of conversation history to include in Claude context? Fixed N messages or adaptive token budget?
3. **Monetization model**: Free tier limits? Per-seat vs per-repo vs per-usage pricing?

---

## 17. References

### Architecture Research
- [Cursor + Turbopuffer: 100B vectors at scale](https://turbopuffer.com/customers/cursor)
- [How Cursor indexes codebases](https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/)
- [Cursor Cloud Agents: Computer Use](https://cursor.com/blog/agent-computer-use)
- [Inside Cloud VMs Powering Autonomous Coding Agents](https://alexlavaee.me/blog/cloud-vms-autonomous-agent-infrastructure/)
- [Building Real-Time AI Chat Infrastructure](https://render.com/articles/real-time-ai-chat-websockets-infrastructure)

### Auth
- [Better Auth docs](https://better-auth.com/)
- [GitHub App vs OAuth App](https://nango.dev/blog/github-app-vs-github-oauth)
- [GitHub App installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [OpenStatus: Clerk → Auth.js migration](https://www.openstatus.dev/blog/migration-auth-clerk-to-next-auth)

### Streaming
- [How ChatGPT streams responses](https://blog.theodormarcu.com/p/how-chatgpt-streams-responses-back)
- [SSE: The Streaming Backbone of LLMs](https://procedure.tech/blogs/the-streaming-backbone-of-llms-why-server-sent-events-(sse)-still-wins-in-2025)
- [Claude Streaming Messages docs](https://platform.claude.com/docs/en/build-with-claude/streaming)

### Agent SDKs
- [Claude Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Vercel AI SDK docs](https://ai-sdk.dev/docs/introduction)
- [Vercel Coding Agent Platform template](https://vercel.com/templates/ai/coding-agent-platform)
- [Trigger.dev AI Agents](https://trigger.dev/product/ai-agents)

### Infrastructure
- [Trigger.dev Realtime Streams v2](https://trigger.dev/changelog/realtime-streams-v2)
- [Qdrant multitenancy guide](https://qdrant.tech/documentation/guides/multitenancy/)
- [Cloudflare R2](https://www.cloudflare.com/developer-platform/products/r2/)
- [Neon serverless Postgres](https://neon.com/pricing)
