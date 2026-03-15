# CodeIndexer

## What
A first-principles Cursor-inspired semantic code search engine. Indexes codebases using AST chunking, vector embeddings, and hybrid search (semantic + ripgrep with RRF fusion).

## Stack
- **Runtime:** Node.js + tsx
- **Parsing:** tree-sitter (native N-API) + tree-sitter-typescript
- **Embeddings:** Voyage AI `voyage-code-3` (1024-dim)
- **Vector DB:** Qdrant Cloud (HNSW index, cosine distance)
- **Local DB:** better-sqlite3 (file hashes + chunk cache)
- **File discovery:** git ls-files (primary) + fast-glob (fallback)
- **Text search:** ripgrep via execFile
- **Language:** TypeScript

## Architecture

Six phases, each teaching one concept:

1. **File walking & AST chunking** — `walker.ts`, `chunker.ts`
2. **Embeddings** — `embedder.ts` (Voyage AI, batched)
3. **Vector store + SQLite cache** — `store.ts`, `db.ts`
4. **Semantic search** — `search.ts` (query embedding → Qdrant top-K → read from disk)
5. **Hybrid search** — `grep.ts`, `merge.ts` (ripgrep + semantic, RRF fusion)
6. **Incremental sync** — `hash.ts`, `sync.ts` (Merkle tree, two-level diff)

## File Structure
```
src/
├── languages.ts    # LANGUAGE_MAP, AST_LANGUAGES, TEXT_LANGUAGES
├── walker.ts       # git ls-files (primary) + fast-glob (fallback) + binary check
├── chunker.ts      # tree-sitter AST parsing + text chunking (md/json/yaml/sql)
├── hash.ts         # SHA-256 via Node crypto
├── embedder.ts     # Voyage AI batched embeddings
├── db.ts           # better-sqlite3, file_hashes + chunk_cache tables
├── store.ts        # Qdrant upsert + collection init
├── search.ts       # query, retrieve, merge
├── grep.ts         # ripgrep via execFile
├── merge.ts        # RRF fusion algorithm
└── sync.ts         # incremental two-level diff
index.ts            # CLI entrypoint: index | search | watch
```

## File Categories
- **AST-chunkable (code):** .ts .tsx .js .jsx .mjs .cjs .py .rs .go .css .graphql .gql
- **Text-chunkable (non-code):** .md .mdx (by headings), .json .yaml .yml .toml (by top-level keys), .sql (by statements)
- **Never index:** Anything in .gitignore (primary filter), plus binary file check as safety net

## Chunking Strategies
- **Code files:** tree-sitter AST → top-level nodes (function_declaration, class_declaration, etc.)
- **Markdown:** split on `## heading` boundaries
- **JSON/YAML/TOML:** small files → single chunk; large files → top-level keys
- **SQL:** split on semicolons, keep preceding comments
- **Binary check:** null byte in first 512 bytes → skip file regardless of extension

## Language-Specific AST Node Types
- **TypeScript/JS:** function_declaration, class_declaration, lexical_declaration, export_statement, interface_declaration, type_alias_declaration, enum_declaration
- **Python:** function_definition, class_definition, decorated_definition
- **Rust:** function_item, impl_item, struct_item, enum_item, trait_item

## Build Order (Phase 1)
1. TypeScript only → full pipeline end-to-end
2. Add Python → different grammar node types
3. Add Markdown → heading chunker (different code path)
4. Add JSON/YAML → fallback/simple case
5. Everything else → mechanical additions to LANGUAGE_MAP

## Key Design Decisions
- **tree-sitter native over web-tree-sitter** — native N-API works on Node darwin-arm64; simpler API (sync init, no WASM path management); same approach Cursor uses in production.
- **git ls-files over manual ignore lists** — .gitignore already defines what's noise. Primary filter via `git ls-files --cached --others --exclude-standard`. Manual ignore list as fallback for non-git dirs only.
- **Code never stored in Qdrant** — only pointers (filePath + line range). Code read from disk at query time. Same privacy model as Cursor.
- **Two-level caching** — file-level SHA-256 to detect changed files, chunk-level SHA-256 to skip re-embedding unchanged chunks.
- **RRF fusion (k=60)** — merges semantic + grep rankings without score normalization. `score = 1/(k + rank)`.

## Node equivalents (migrated from Bun)
| Concept | Implementation |
|---|---|
| File reading | `fs.readFile(path, 'utf-8')` or `fs.readFileSync(path, 'utf-8')` |
| File discovery | `fast-glob` or `git ls-files` via `execFile` |
| Subprocess | `execFile` from `child_process` (never use `exec` — shell injection risk) |
| SQLite | `better-sqlite3` |
| Run scripts | `npx tsx index.ts` |
| Crypto | `crypto.createHash('sha256')` |

## SQLite Schema
```sql
CREATE TABLE file_hashes (
  file_path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE chunk_cache (
  chunk_hash TEXT PRIMARY KEY, qdrant_id TEXT NOT NULL,
  file_path TEXT NOT NULL, line_start INTEGER NOT NULL, line_end INTEGER NOT NULL
);
```

## CLI Usage
```bash
npx tsx index.ts index          # index codebase
npx tsx index.ts search "query" # search with --mode semantic|grep|hybrid
npx tsx index.ts watch          # live re-indexing via fs.watch
```

## Environment Variables
```
VOYAGE_API_KEY=...
QDRANT_URL=...
QDRANT_KEY=...
```

## Conventions
- User is learning — explain concepts before coding
- Build simplest working version first, then iterate
- Run first-principles checkpoint after each phase before moving on
- Reference Cursor blog posts for real-world context
