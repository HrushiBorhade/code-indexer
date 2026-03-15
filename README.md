# CodeIndexer

A semantic code search engine built from first principles. Inspired by how [Cursor](https://cursor.com) indexes codebases — AST-aware chunking, vector embeddings, hybrid search, and incremental sync via Merkle trees.

## What it does

Point it at any codebase. It parses every file into meaningful chunks using tree-sitter ASTs (functions, classes, interfaces — not arbitrary line splits), embeds them with Voyage AI, stores vectors in Qdrant, and lets you search with natural language.

"Where do we handle authentication?" returns the actual auth functions — even if they never contain the word "authentication."

## How it works

```
Codebase → Walk → Chunk → Embed → Store → Search
             │       │       │        │       │
         git ls-files │   Voyage AI  Qdrant  Hybrid:
         .gitignore   │   voyage-code-3      semantic + ripgrep
                      │                      merged via RRF
               tree-sitter AST
               splits by function/class
               not by line count
```

### The pipeline

1. **File discovery** — `git ls-files` respects `.gitignore` automatically. Binary detection via null-byte heuristic as safety net.

2. **AST chunking** — tree-sitter parses code into syntax trees. Each function, class, or declaration becomes its own chunk with exact line numbers. Markdown splits on headings. JSON/YAML splits on top-level keys.

3. **Embeddings** — Voyage AI's `voyage-code-3` model turns each chunk into a 1024-dimensional vector. Semantically similar code produces nearby vectors.

4. **Vector storage** — Qdrant stores vectors with HNSW indexing for O(log n) nearest-neighbor search. Only pointers (file path + line range) are stored — code is read from disk at query time.

5. **Hybrid search** — Combines semantic search (conceptual matches) with ripgrep (exact text matches). Results merged via Reciprocal Rank Fusion (RRF). Hybrid beats either approach alone.

6. **Incremental sync** — Merkle tree with two-level caching. File-level SHA-256 detects changed files. Chunk-level SHA-256 skips re-embedding unchanged chunks. Re-indexing a codebase after one file change takes seconds, not minutes.

## Tech stack

| Component | Technology |
|---|---|
| Runtime | Node.js |
| Language | TypeScript |
| Parsing | tree-sitter (native N-API) |
| Embeddings | Voyage AI `voyage-code-3` |
| Vector DB | Qdrant Cloud |
| Local cache | better-sqlite3 |
| Text search | ripgrep |
| File discovery | git ls-files + fast-glob |

## Supported languages

**AST chunking:** TypeScript, JavaScript, Python, Rust, Go, CSS, GraphQL

**Text chunking:** Markdown (by headings), JSON/YAML (by top-level keys), SQL (by statements)

## Getting started

### Prerequisites

- Node.js >= 20
- ripgrep (`brew install ripgrep`)
- A [Voyage AI](https://voyageai.com) API key (free tier: 200M tokens/month)
- A [Qdrant Cloud](https://cloud.qdrant.io) cluster (free tier: 1GB)

### Setup

```bash
git clone https://github.com/yourusername/code-indexer.git
cd code-indexer
npm install
cp .env.example .env
# Fill in your API keys in .env
```

### Usage

```bash
# Index a codebase
npm run dev:index -- /path/to/your/project

# Search
npm run dev:search -- "where do we handle errors"

# Watch for changes and re-index automatically
npm run dev:watch -- /path/to/your/project
```

### Development

```bash
npm run dev            # Run with tsx (JIT compilation)
npm run build          # Compile to dist/
npm run typecheck      # Type check without building
npm run lint           # ESLint
npm run lint:fix       # ESLint with auto-fix
npm run format         # Prettier format
npm run format:check   # Check formatting
```

## Architecture

Built in six phases, each teaching one concept:

| Phase | Concept | Files |
|---|---|---|
| 1 | File walking & AST chunking | `walker.ts`, `chunker.ts`, `languages.ts` |
| 2 | Embeddings | `embedder.ts` |
| 3 | Vector store + SQLite cache | `store.ts`, `db.ts` |
| 4 | Semantic search | `search.ts` |
| 5 | Hybrid search (semantic + ripgrep) | `grep.ts`, `merge.ts` |
| 6 | Incremental sync (Merkle tree) | `hash.ts`, `sync.ts` |

### Why these design decisions?

| Decision | Rationale |
|---|---|
| AST chunking over line splitting | Line splits cut functions in half. AST boundaries preserve semantic units. |
| Code never stored in vector DB | Only pointers (file + line range). Code read from disk at query time. Same privacy model as Cursor. |
| git ls-files over manual ignore lists | `.gitignore` already defines what matters. Don't reinvent it. |
| Hybrid search over pure semantic | Semantic misses exact symbol names. Ripgrep misses meaning. Combined improves accuracy ~12.5% (per Cursor). |
| Merkle tree for sync | One file change re-indexes 3 chunks, not 3000. Same principle as Git's object model. |
| RRF for rank fusion | Merges two ranked lists without score normalization. Simple, proven, standard. |

## Roadmap

- [x] Project setup (Node.js, TypeScript, tree-sitter, ESLint, Prettier, CI)
- [ ] Phase 1: File walking & AST chunking
- [ ] Phase 2: Embeddings (Voyage AI)
- [ ] Phase 3: Vector store (Qdrant) + SQLite cache
- [ ] Phase 4: Semantic search
- [ ] Phase 5: Hybrid search (semantic + ripgrep + RRF)
- [ ] Phase 6: Incremental sync (Merkle tree)
- [ ] Web UI: GitHub OAuth, repo explorer, chat sidebar
- [ ] Worker-based indexing via job queues (BullMQ + Redis)
- [ ] Chat: search results as context → LLM answers

## Inspired by

- [Cursor's codebase indexing](https://cursor.com/blog/secure-codebase-indexing)
- [Cursor's semantic search](https://cursor.com/blog/semsearch)

## License

ISC
