# Phase 2, Step 3: Trigger.dev index-repo Task — Design Spec

> Date: 2026-03-24
> Status: Draft
> Author: Hrushi + Claude
> Issue: #71, #72

---

## 1. Goal

When a user connects a GitHub repo via the GitHub App, the repo is automatically indexed in the background. Status transitions: `pending → cloning → indexing → ready`. The user sees progress on the dashboard.

## 2. Architecture

```
Webhook (apps/web)                    Trigger.dev Cloud (apps/trigger)
┌────────────────────┐               ┌──────────────────────────────────────┐
│ installation.created│──trigger──→  │  index-repo task                      │
│ push event         │──trigger──→  │                                       │
└────────────────────┘               │  1. Generate GitHub App token          │
                                     │  2. Download tarball via GitHub API    │
                                     │  3. Extract to /tmp/{repoId}/         │
                                     │  4. walkFiles → chunkFile → embed     │
                                     │  5. Upsert vectors to Qdrant          │
                                     │  6. Persist Merkle state (Postgres)   │
                                     │  7. Upload files to R2                │
                                     │  8. Update repo status → "ready"      │
                                     │  9. Cleanup /tmp/{repoId}/            │
                                     └──────────────────────────────────────┘
```

## 3. Why Tarball, Not Git Clone

| Approach | Download size | Disk usage | Speed | Dependencies |
|----------|-------------|-----------|-------|-------------|
| `git clone --depth 1` | Large (includes .git metadata) | ~2x source size | Slow (git protocol) | Needs `git` binary |
| **GitHub Tarball API** | Small (source only, compressed) | ~1x source size | Fast (HTTP CDN) | Just `tar` extraction |
| GitHub Trees + Blobs API | Per-file fetches | Zero disk | Very slow | 1 API call per file |

Tarball wins: smaller download, no `.git` directory, GitHub CDN-cached, and the downloaded tarball is the same file we upload to R2.

## 4. File Structure

```
apps/trigger/
├── package.json              # @codeindexer/trigger
├── tsconfig.json
├── trigger.config.ts         # Trigger.dev project config
└── src/
    ├── tasks/
    │   ├── index-repo.ts     # Full index: download → chunk → embed → store
    │   └── sync-repo.ts      # Incremental: Merkle diff → re-embed changed only
    └── lib/
        ├── github.ts         # Installation token generation + tarball download
        ├── drizzle-sync-storage.ts  # SyncStorage impl for Neon Postgres
        └── r2.ts             # Upload files/tarball/file-tree.json to R2
```

## 5. index-repo Task — Detailed Flow

### Input
```typescript
{ repoId: string }
```

### Steps

**Step 1: Load repo metadata**
```sql
SELECT id, full_name, installation_id, default_branch FROM repos WHERE id = $1
```
Set `status = 'cloning'`. Create `indexJobs` record with `status = 'running'`, `trigger = 'initial'`.

**Step 2: Generate GitHub App installation token**
```
POST https://api.github.com/app/installations/{installationId}/access_tokens
Authorization: Bearer {JWT signed with App private key}
→ { token: "ghs_xxx", expires_at: "..." }
```
JWT is signed using the App's RSA private key with `iss = APP_ID`, `exp = now + 10min`.

**Step 3: Download tarball**
```
GET https://api.github.com/repos/{fullName}/tarball/{defaultBranch}
Authorization: Bearer {installation_token}
→ 302 redirect → stream response → write to /tmp/{repoId}.tar.gz
```
Extract to `/tmp/{repoId}/`. The GitHub tarball wraps files in a top-level directory like `owner-repo-sha/` — we strip this prefix during extraction.

Set `status = 'indexing'`.

**Step 4: Walk files**
```typescript
const files = await walkFiles(`/tmp/${repoId}`);
// Returns absolute paths of supported, non-binary files
```

**Step 5: Chunk all files**
```typescript
const allChunks: Chunk[] = [];
for (const file of files) {
  const chunks = await chunkFile(file);
  allChunks.push(...chunks);
}
```
Sequential to avoid WASM concurrency issues with web-tree-sitter. Each `chunkFile` call is fast (~1-5ms per file).

**Step 6: Embed chunks**
```typescript
const vectors = await embedChunks(allChunks);
// Batched (128/batch), retried (5x exponential backoff)
// Returns number[][] aligned with allChunks
```

**Step 7: Upsert to Qdrant**
```typescript
await ensureCollection(); // Creates collection + repo_id payload index if not exists

const points: UpsertPoint[] = allChunks.map((chunk, i) => ({
  vector: vectors[i],
  payload: {
    repo_id: repoId,
    content: chunk.content,
    filePath: path.relative(cloneDir, chunk.filePath),
    lineStart: chunk.lineStart,
    lineEnd: chunk.lineEnd,
    language: chunk.language,
    chunkHash: hashString(chunk.content),
  },
}));

await upsertPoints(points); // Batched in groups of 100
```

**Step 8: Persist Merkle state**
```typescript
const storage = new DrizzleSyncStorage(db, repoId);
const result = await computeChanges(files, cloneDir, storage);
await persistMerkleState(files, result.fileHashMap, new Set(files), cloneDir, storage);
```

**Step 9: Upload to R2**
```typescript
// 1. Upload tarball (already downloaded)
await r2.upload(`repos/${repoId}/repo.tar.gz`, tarballBuffer);

// 2. Build and upload file tree
const fileTree = buildFileTree(files, cloneDir);
await r2.upload(`repos/${repoId}/file-tree.json`, JSON.stringify(fileTree));

// 3. Upload individual files (for web IDE)
for (const file of files) {
  const relativePath = path.relative(cloneDir, file);
  const content = await fs.readFile(file);
  await r2.upload(`repos/${repoId}/files/${relativePath}`, content);
}
```

**Step 10: Update repo**
```sql
UPDATE repos SET
  status = 'ready',
  file_count = $fileCount,
  chunk_count = $chunkCount,
  last_indexed_at = now(),
  last_commit_sha = $headSha,
  r2_tar_key = 'repos/{repoId}/repo.tar.gz'
WHERE id = $repoId
```

Update `indexJobs` record: `status = 'completed'`, `filesChanged`, `chunksEmbedded`, `completedAt`.

**Step 11: Cleanup**
```typescript
// Always runs, even on error (in finally block)
await fs.rm(`/tmp/${repoId}`, { recursive: true, force: true });
await fs.rm(`/tmp/${repoId}.tar.gz`, { force: true });
```

### Error handling

On ANY error during steps 1-10:
```sql
UPDATE repos SET status = 'error', index_error = $errorMessage
```
Update `indexJobs`: `status = 'failed'`, `error = $errorMessage`, `completedAt = now()`.
Cleanup still runs (finally block).

## 6. sync-repo Task (incremental re-indexing)

Triggered by `push` webhook. Same as `index-repo` but:
- Downloads fresh tarball
- Uses `computeChanges()` with existing Merkle state → gets `added`, `modified`, `deleted` lists
- Only chunks + embeds `added` and `modified` files
- Deletes Qdrant vectors for chunks from `deleted` files (via chunkCache lookup)
- Re-persists Merkle state
- Re-uploads changed files to R2

Guard: if `index-repo` is currently running for this repo (check `indexJobs` status), store the push SHA in `queuedSha` and skip. The `index-repo` task checks `queuedSha` on completion and triggers `sync-repo` if set.

## 7. DrizzleSyncStorage

Implements the `SyncStorage` interface from `packages/core/src/lib/sync.ts`, scoped by `repoId`.

```typescript
class DrizzleSyncStorage implements SyncStorage {
  constructor(private db: Database, private repoId: string) {}

  async getFileHash(filePath: string): Promise<string | null> {
    const row = await this.db.query.fileHashes.findFirst({
      where: and(eq(fileHashes.repoId, this.repoId), eq(fileHashes.filePath, filePath)),
    });
    return row?.sha256 ?? null;
  }

  async setFileHash(filePath: string, hash: string): Promise<void> {
    await this.db.insert(fileHashes).values({
      repoId: this.repoId, filePath, sha256: hash,
    }).onConflictDoUpdate({
      target: [fileHashes.repoId, fileHashes.filePath],
      set: { sha256: hash, updatedAt: new Date() },
    });
  }

  async getDirHash(dirPath: string): Promise<string | null> {
    const row = await this.db.query.dirHashes.findFirst({
      where: and(eq(dirHashes.repoId, this.repoId), eq(dirHashes.dirPath, dirPath)),
    });
    return row?.merkleHash ?? null;
  }

  async setDirHash(dirPath: string, hash: string): Promise<void> {
    await this.db.insert(dirHashes).values({
      repoId: this.repoId, dirPath, merkleHash: hash,
    }).onConflictDoUpdate({
      target: [dirHashes.repoId, dirHashes.dirPath],
      set: { merkleHash: hash, updatedAt: new Date() },
    });
  }

  async clearDirHashes(): Promise<void> {
    await this.db.delete(dirHashes).where(eq(dirHashes.repoId, this.repoId));
  }

  async getAllFileHashes(): Promise<Map<string, string>> {
    const rows = await this.db.query.fileHashes.findMany({
      where: eq(fileHashes.repoId, this.repoId),
    });
    return new Map(rows.map(r => [r.filePath, r.sha256]));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Neon HTTP driver doesn't support multi-statement transactions.
    // Operations are individually atomic via upserts. Acceptable for
    // Merkle state persistence — worst case is a partial write that
    // gets corrected on the next sync.
    return fn();
  }
}
```

## 8. Modifications to Existing Code

### packages/core/src/config/env.ts
Replace `process.exit(1)` with `throw new Error()`. A library package should never call `process.exit`.

### packages/core/src/lib/store.ts
- Add `repo_id: string` and `content: string` to `PointPayload` interface
- Add `repoId` filter parameter to `searchPoints()` and `deletePoints()`
- Add payload index creation for `repo_id` field in `ensureCollection()`

### apps/web/src/app/api/webhooks/github/route.ts
- After `upsertRepos()`, trigger `index-repo` task for each new repo
- Handle `push` event: trigger `sync-repo` task

### turbo.json
Add Trigger.dev env vars to the build task env array.

### .env.example
Add new env vars: `TRIGGER_SECRET_KEY`, `QDRANT_URL`, `QDRANT_KEY`, `OPENAI_API_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`.

## 9. Cost Analysis

### Per-repo cost (medium repo: 200 files, ~2,400 chunks)

| Service | Usage | Cost |
|---------|-------|------|
| GitHub API | 2 calls (token + tarball) | $0 |
| OpenAI Embeddings | ~840K tokens | $0.017 |
| Qdrant Cloud | ~2,400 vectors | $0 (free: 100K vectors) |
| Cloudflare R2 | ~20MB storage | $0 (free: 10GB) |
| Trigger.dev | 1 run, ~60s | $0 (free: 50K runs) |

### Scale limits on free tiers

| Service | Free limit | Repos before paid |
|---------|-----------|-------------------|
| Qdrant | ~100K vectors | ~40 medium repos |
| R2 | 10GB | ~500 small repos |
| OpenAI | Rate limited, not cost limited | Unlimited (pay per use) |
| Trigger.dev | 50K runs/month | Unlimited for indexing |

## 10. Prerequisites

| Service | Action | Env var |
|---------|--------|---------|
| Trigger.dev | Sign up → create project | `TRIGGER_SECRET_KEY` |
| Qdrant Cloud | Create free cluster | `QDRANT_URL`, `QDRANT_KEY` |
| OpenAI | Get API key | `OPENAI_API_KEY` |
| Cloudflare R2 | Create bucket + API token | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT` |

## 11. Testing Strategy

- **DrizzleSyncStorage**: Unit tests against real Neon DB (test branch)
- **GitHub token generation**: Unit test with mocked HTTP
- **Tarball download + extraction**: Integration test with a small public repo
- **index-repo task**: End-to-end test triggering against a test repo
- **Existing tests**: All 152 core tests must continue to pass

## 12. Build Order

1. Fix `env.ts` (process.exit → throw)
2. Extend `store.ts` (repo_id payload, filters, index)
3. Scaffold `apps/trigger/` package
4. Implement `DrizzleSyncStorage`
5. Implement `lib/github.ts` (token + tarball download)
6. Implement `lib/r2.ts` (file uploads)
7. Implement `index-repo` task (wires everything together)
8. Implement `sync-repo` task
9. Wire webhook → task trigger
10. Test end-to-end with a real repo
