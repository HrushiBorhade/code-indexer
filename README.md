# CodeIndexer

A semantic code search engine built from first principles. Inspired by how [Cursor](https://cursor.com) indexes codebases — AST-aware chunking, vector embeddings, hybrid search, and incremental sync via Merkle trees.

## What it does

Point it at any codebase. It parses every file into meaningful chunks using tree-sitter ASTs (functions, classes, interfaces — not arbitrary line splits), embeds them with configurable providers (OpenAI or Voyage AI), stores vectors in Qdrant, caches state in SQLite, and lets you search with natural language. Incremental — re-indexing after one file change skips everything unchanged.

"Where do we handle authentication?" returns the actual auth functions — even if they never contain the word "authentication."

## How it works

```
Codebase → Walk → Hash → Chunk → Embed → Store → Search
             │      │       │       │        │       │
         git ls-files│       │   OpenAI/   Qdrant  Hybrid:
         .gitignore  │       │   Voyage    + SQLite semantic + ripgrep
                  SHA-256    │              cache   merged via RRF
                  skip    tree-sitter AST
                unchanged splits by function/class
                           not by line count
```

### The pipeline

1. **File discovery** — `git ls-files` respects `.gitignore` automatically. Binary detection via null-byte heuristic as safety net. Fast-glob fallback for non-git directories.

2. **AST chunking** — tree-sitter parses code into syntax trees. Each function, class, or declaration becomes its own chunk with exact line numbers. Markdown splits on headings. JSON/YAML splits on top-level keys. SQL splits on statements. GraphQL splits on type definitions.

3. **Embeddings** — Configurable provider: OpenAI `text-embedding-3-small` (1536-dim, for dev) or Voyage AI `voyage-code-3` (1024-dim, for production). Batched with bounded concurrency, retry with exponential backoff + jitter.

4. **Vector storage** — Qdrant stores vectors with HNSW indexing for O(log n) nearest-neighbor search. Only pointers (file path + line range) are stored — code is read from disk at query time. SQLite caches file hashes and chunk-to-Qdrant ID mappings locally.

5. **Incremental indexing** — SHA-256 hash of each file compared against SQLite cache. Unchanged files skip embedding entirely. Deleted files are cleaned up from both Qdrant and SQLite. Second run on unchanged codebase completes instantly.

6. **Hybrid search** — Combines semantic search (conceptual matches) with ripgrep (exact text matches). Results merged via Reciprocal Rank Fusion (RRF). Hybrid beats either approach alone.

7. **Incremental sync** — Merkle tree with two-level caching. File-level SHA-256 detects changed files. Chunk-level SHA-256 skips re-embedding unchanged chunks. Re-indexing a codebase after one file change takes seconds, not minutes.

## Tech stack

| Component | Technology |
|---|---|
| Runtime | Node.js |
| Language | TypeScript |
| CLI | commander |
| Parsing | tree-sitter (native N-API) |
| Embeddings | OpenAI / Voyage AI (configurable) |
| Vector DB | Qdrant Cloud |
| Local cache | better-sqlite3 |
| Text search | ripgrep |
| File discovery | git ls-files + fast-glob |

## Supported languages

**AST chunking (tree-sitter):** TypeScript, TSX, JavaScript, Python, Rust, Go, CSS

**Text chunking:** Markdown (by headings), JSON (by top-level keys), YAML/TOML (by top-level keys), SQL (by statements), GraphQL (by type definitions)

## Getting started

### Prerequisites

- Node.js >= 20
- Git
- ripgrep (`brew install ripgrep`)
- An [OpenAI](https://platform.openai.com) API key (recommended for dev, generous rate limits) OR a [Voyage AI](https://voyageai.com) API key (code-optimized, free tier: 3 RPM)
- A [Qdrant Cloud](https://cloud.qdrant.io) cluster (free tier: 1GB)

### Setup

```bash
git clone https://github.com/HrushiBorhade/code-indexer.git
cd code-indexer
npm install
cp .env.example .env
# Fill in your API keys in .env
```

### CLI Usage

```bash
# Index a codebase (default: current directory)
npx tsx src/index.ts index [path]

# Search indexed codebase
npx tsx src/index.ts search "where do we handle errors"
npx tsx src/index.ts search "auth middleware" --mode semantic
npx tsx src/index.ts search "handleRequest" -m grep

# Watch for changes and re-index
npx tsx src/index.ts watch [path]

# Help
npx tsx src/index.ts --help
npx tsx src/index.ts search --help

# Version
npx tsx src/index.ts --version
```

**Search modes:**

| Mode | What it does |
|------|-------------|
| `hybrid` (default) | Semantic + ripgrep, merged with RRF fusion |
| `semantic` | Vector similarity search only |
| `grep` | Exact text match via ripgrep only |

### Development

```bash
npm run dev            # Run with tsx
npm run build          # Compile to dist/
npm run typecheck      # Type check without building
npm run lint           # ESLint
npm run lint:fix       # ESLint with auto-fix
npm run format         # Prettier format
npm run format:check   # Check formatting
npm test               # Run tests (vitest)
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report
```

## Architecture

Built in six phases, each teaching one concept:

| Phase | Concept | Files |
|---|---|---|
| 1 | File walking & AST chunking | `languages.ts`, `walker.ts`, `chunker/` |
| 2 | Embeddings | `embedder.ts` (configurable OpenAI/Voyage) |
| 3 | Vector store + SQLite cache | `store.ts`, `db.ts`, `hash.ts`, `shutdown.ts` |
| 4 | Semantic search | `search.ts` |
| 5 | Hybrid search (semantic + ripgrep) | `grep.ts`, `merge.ts` |
| 6 | Incremental sync (Merkle tree) | `sync.ts` |

### Project structure

```
src/
├── index.ts               # CLI entrypoint (commander)
├── config/
│   └── env.ts             # Zod-validated environment variables + dotenv
├── lib/
│   ├── languages.ts       # Language registry (LANGUAGE_MAP, extensions, types)
│   ├── walker.ts          # File discovery (git ls-files + fast-glob + binary check)
│   ├── embedder.ts        # Configurable embedding (OpenAI/Voyage), batching, retry
│   ├── hash.ts            # SHA-256 file and string hashing
│   ├── db.ts              # SQLite cache (better-sqlite3, WAL mode)
│   ├── store.ts           # Qdrant vector store (upsert, delete, search)
│   ├── search.ts          # Semantic search orchestrator
│   ├── grep.ts            # Ripgrep text search wrapper
│   ├── merge.ts           # RRF fusion algorithm
│   ├── sync.ts            # Merkle tree incremental sync
│   └── shutdown.ts        # Graceful shutdown (SIGINT/SIGTERM handler)
├── chunker/               # Modular chunking strategies
│   ├── index.ts           # Router — dispatches to correct strategy
│   ├── types.ts           # Chunk interface
│   ├── ast.ts             # tree-sitter parsing (TS, TSX, JS, Python, Rust, Go, CSS)
│   ├── split-by-boundary.ts # Shared line-splitting helper
│   ├── markdown.ts        # Heading-based splitting
│   ├── json.ts            # Top-level key splitting
│   ├── yaml.ts            # Top-level key splitting (also TOML)
│   ├── sql.ts             # Semicolon-based splitting
│   ├── graphql.ts         # Definition keyword splitting
│   └── fallback.ts        # Whole-file-as-one-chunk fallback
└── utils/
    └── logger.ts          # Pino structured logging (JSON prod, pretty dev)
```

### Why these design decisions?

| Decision | Rationale |
|---|---|
| AST chunking over line splitting | Line splits cut functions in half. AST boundaries preserve semantic units. |
| Code never stored in vector DB | Only pointers (file + line range). Code read from disk at query time. Same privacy model as Cursor. |
| git ls-files over manual ignore lists | `.gitignore` already defines what matters. Don't reinvent it. |
| tree-sitter native over WASM | Native N-API works on Node darwin-arm64. Simpler API, sync init. Same approach Cursor uses. |
| commander over hand-rolled args | Auto `--help`, `--version`, flag validation, short aliases. Used by Vite, Prisma, tRPC. |
| Modular chunker directory | 8 strategies in one file = 400+ lines. Each file < 80 lines. Adding a language = one new file. |
| Hybrid search over pure semantic | Semantic misses exact symbol names. Ripgrep misses meaning. Combined improves accuracy ~12.5% (per Cursor). |
| Merkle tree for sync | One file change re-indexes 3 chunks, not 3000. Same principle as Git's object model. |
| RRF for rank fusion | Merges two ranked lists without score normalization. Simple, proven, standard. |

## Roadmap

- [x] Project setup (Node.js, TypeScript, tree-sitter, ESLint, Prettier, Vitest, CI)
- [x] Phase 1: File walking & AST chunking
  - [x] Language registry with AST/text classification
  - [x] File walker (git ls-files + fast-glob fallback + binary check)
  - [x] Modular chunker (7 AST languages + 6 text strategies)
  - [x] CLI entrypoint with commander
- [x] Phase 2: Embeddings
  - [x] Configurable provider (OpenAI for dev, Voyage for production)
  - [x] Batched embedding with bounded concurrency
  - [x] Retry with exponential backoff + jitter
  - [x] Zod-validated environment variables
  - [x] Pino structured logging
- [x] Phase 3: Vector store + SQLite cache
  - [x] SHA-256 file hashing for change detection
  - [x] SQLite cache (file hashes + chunk-to-Qdrant ID mapping)
  - [x] Qdrant vector store (upsert, delete, search with retry)
  - [x] Graceful shutdown (SIGINT/SIGTERM)
  - [x] Incremental indexing (skip unchanged files)
  - [x] Deleted file cleanup
- [x] Phase 4: Semantic search
  - [x] Search orchestrator (embed query → Qdrant top-K → read code from disk)
  - [x] Parallel file reads for result snippets
  - [x] CLI search command with --limit, --path, --mode options
- [x] Phase 5: Hybrid search (semantic + ripgrep + RRF)
  - [x] Ripgrep wrapper (execFile, JSON output, --fixed-strings, --smart-case)
  - [x] RRF fusion algorithm (k=60, deduplication, combined scoring)
  - [x] Three modes: semantic, grep, hybrid (default)
  - [x] Parallel execution of semantic + grep in hybrid mode
- [x] Phase 6: Incremental sync (Merkle tree)
  - [x] Merkle tree builder with directory-level hashing
  - [x] Two-level diff: skip unchanged directory subtrees, then file-level comparison
  - [x] Bounded concurrency (32) for file hashing with graceful failure handling
  - [x] dir_hashes SQLite table for persisting directory Merkle state
- [ ] Web UI: GitHub OAuth, repo explorer, chat sidebar
- [ ] Worker-based indexing via job queues (BullMQ + Redis)
- [ ] Chat: search results as context → LLM answers

## Inspired by

- [Cursor's codebase indexing](https://cursor.com/blog/secure-codebase-indexing)
- [Cursor's semantic search](https://cursor.com/blog/semsearch)

## License

ISC
