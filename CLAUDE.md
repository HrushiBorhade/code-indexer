# CodeIndexer

## What
A Cursor-inspired semantic code search engine and AI-powered code assistant platform. Started as a CLI tool (Phases 1-6, complete), now building the web platform.

## Current State
- **CLI (complete):** 6 phases shipped — AST chunking, embeddings, vector store, semantic search, hybrid search (RRF), incremental sync (Merkle trees). 152 tests passing.
- **Platform (in progress):** Design spec merged at `docs/specs/platform-design.md`. Implementation starting.

## CLI Stack (src/ — existing, working)
- **Runtime:** Node.js + tsx
- **Parsing:** tree-sitter (native N-API) + grammars for TS/JS/Python/Rust/Go/CSS
- **Embeddings:** OpenAI `text-embedding-3-small` (1536-dim). Also supports Voyage AI `voyage-code-3` (1024-dim).
- **Vector DB:** Qdrant Cloud (HNSW, cosine distance)
- **Local DB:** better-sqlite3 (file_hashes, chunk_cache, dir_hashes tables)
- **Text search:** ripgrep via execFile
- **Hybrid search:** RRF fusion (k=60) merging semantic + ripgrep results

## Platform Architecture (docs/specs/platform-design.md)

Three services:
1. **Next.js (Vercel)** — UI, auth, webhooks, dashboard, web IDE
2. **Hono API (Fly.io)** — Chat/agent SSE streaming, search API, file serving
3. **Trigger.dev (Cloud)** — Background indexing, sync, cleanup

Data layer:
- **Neon Postgres** (Drizzle ORM) — users, repos, hashes, conversations, jobs
- **Qdrant Cloud** — vectors + chunk content in payload, BM25 full-text search
- **Cloudflare R2** — repo tarballs, exploded files, file-tree.json
- **Claude API** — chat/agent (Sonnet default, Opus opt-in)
- **OpenAI API** — embeddings only

Key decisions:
- **Auth:** Better Auth (GitHub OAuth) + GitHub App (installation tokens, push webhooks, RS256 JWT)
- **Chat streaming:** Direct SSE from Hono → Claude (NOT via task queue). Users stare at streaming = persistent server. Background jobs = task queue.
- **Search:** Qdrant vector + BM25 on `content` payload → RRF merge (replaces ripgrep in cloud)
- **Re-index:** GitHub push webhook → Trigger.dev → fresh shallow clone → Merkle diff → re-embed changed only
- **Storage:** Chunk content stored in Qdrant payload (instant search results). Full files in R2 (web IDE).
- **tree-sitter:** Must switch from native N-API to web-tree-sitter (WASM) for Trigger.dev Linux containers.
- **sync.ts:** Needs significant refactor — sync SQLite transactions to async Drizzle. Extract pure Merkle logic into SyncStorage interface.
- **Security:** RS256 asymmetric JWT (Next.js signs, Hono verifies with public key only), middleware-enforced repo ownership on every endpoint, path sanitization on agent tools, global cost circuit breaker for Claude API.

Environments: Preview (Neon branch per PR) → Staging → Production
CI/CD: GitHub Actions (format, lint, typecheck, test, build) on every PR. Auto-deploy to staging/production.
Observability: Vercel OTEL + Analytics + PostHog + Clarity + Sentry (frontend). OpenTelemetry → Grafana Cloud (API/workers). Better Stack uptime + Slack alerting.

## Build Phases (Platform)
1. **Foundation** — Monorepo (Turborepo), Drizzle schema, Better Auth, GitHub App, dashboard
2. **Indexing** — web-tree-sitter, Trigger.dev tasks, Merkle refactor, R2 uploads
3. **Search + Web IDE** — Hono API on Fly.io, JWT bridge, search, file viewer, rate limiting
4. **Chat Agent** — SSE streaming, Claude tool use, conversations, cost circuit breaker
5. **Polish** — Sentry, OTEL, cleanup tasks, webhook replay, emails
6. **Coding Agent** (future) — multi-step editing, PR creation

## File Structure (CLI — existing)
```
src/
├── chunker/        # AST chunking (tree-sitter) + text chunking (md/json/yaml/sql)
├── config/env.ts   # Zod env validation
├── lib/
│   ├── walker.ts   # git ls-files + fast-glob fallback
│   ├── embedder.ts # OpenAI/Voyage batched embeddings
│   ├── hash.ts     # SHA-256
│   ├── db.ts       # better-sqlite3 (file_hashes, chunk_cache, dir_hashes)
│   ├── store.ts    # Qdrant upsert/search/delete
│   ├── search.ts   # semantic search (embed query → Qdrant top-K → read from disk)
│   ├── grep.ts     # ripgrep via execFile
│   ├── merge.ts    # RRF fusion
│   ├── sync.ts     # Merkle tree diff (computeChanges, persistMerkleState)
│   └── shutdown.ts # Graceful shutdown
├── utils/logger.ts # Pino logger
└── index.ts        # CLI entrypoint (commander)
```

## Platform Monorepo Structure (planned)
```
apps/
├── web/        # Next.js (Vercel)
├── api/        # Hono (Fly.io)
└── trigger/    # Trigger.dev tasks + crons + emails
packages/
├── core/       # Existing pipeline code (from src/)
├── db/         # Drizzle schema + Neon client
├── email/      # React Email templates
└── config/     # Shared env validation (per-service .extend())
```

## CLI Usage
```bash
npx tsx index.ts index          # index codebase
npx tsx index.ts search "query" # search with --mode semantic|grep|hybrid
npx tsx index.ts watch          # live re-indexing
```

## Commands
```bash
npm run format:check  # Prettier
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm test              # Vitest (152 tests)
npm run build         # tsc
```

## Conventions
- NEVER add Co-Authored-By, "Generated with Claude Code", or any AI attribution to commits, PRs, or issues
- Always run /commit-ready BEFORE pushing or creating PRs, never after
- User is learning backend/infra — explain concepts before coding
- Build simplest working version first, iterate
- Full platform spec at docs/specs/platform-design.md — refer to it for all architecture decisions
