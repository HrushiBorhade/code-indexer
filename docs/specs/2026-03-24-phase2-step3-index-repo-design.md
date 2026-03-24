# Phase 2, Step 3: Trigger.dev index-repo Task — Design Spec

> Date: 2026-03-24
> Status: Reviewed (v2 — addresses all critical review findings)
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
│ push event         │──trigger──→  │  sync-repo task                       │
└────────────────────┘               │                                       │
                                     │  Pipeline (per batch of files):        │
                                     │  chunk → embed → upsert → next batch  │
                                     │                                       │
                                     │  External services:                    │
                                     │  GitHub API (tarball), Qdrant,        │
                                     │  OpenAI, R2, Neon Postgres            │
                                     └──────────────────────────────────────┘
```

## 3. Why Tarball, Not Git Clone

| Approach | Download size | Disk usage | Speed | Dependencies |
|----------|-------------|-----------|-------|-------------|
| `git clone --depth 1` | Large (includes .git metadata) | ~2x source size | Slow (git protocol) | Needs `git` binary |
| **GitHub Tarball API** | Small (source only, compressed) | ~1x source size | Fast (HTTP CDN) | Just `tar` extraction |
| GitHub Trees + Blobs API | Per-file fetches | Zero disk | Very slow | 1 API call per file |

Tarball wins. The downloaded tarball also serves as the R2 backup — no re-compression needed.

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
        ├── github.ts         # JWT generation, installation token, tarball download+extract
        ├── drizzle-sync-storage.ts  # SyncStorage impl for Neon Postgres
        └── r2.ts             # Upload files/tarball/file-tree.json to R2
```

## 5. index-repo Task — Detailed Flow

### Input
```typescript
{ repoId: string }
```

### Step 1: Idempotency guard + load repo

Check `indexJobs` for an in-progress job for this repo. If one exists, skip (webhook duplicate).

```sql
SELECT id FROM index_jobs WHERE repo_id = $1 AND status = 'running' LIMIT 1
```
If found → return early (already indexing).

```sql
SELECT id, full_name, installation_id, default_branch FROM repos WHERE id = $1
```
Create `indexJobs` record: `status = 'running'`, `trigger = 'initial'`.
Set repo `status = 'cloning'`.

### Step 2: Generate GitHub App installation token

Sign JWT using `node:crypto` (zero dependencies):
```typescript
const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId })).toString('base64url');
const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(key, 'base64url');
```

Exchange JWT for installation token:
```
POST https://api.github.com/app/installations/{installationId}/access_tokens
Authorization: Bearer {jwt}
→ { token: "ghs_xxx", expires_at: "..." }
```

Token is used only for the tarball download (step 3). Single-use, no expiry concern.

### Step 3: Download + extract tarball

```typescript
const res = await fetch(`https://api.github.com/repos/${fullName}/tarball/${defaultBranch}`, {
  headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'CodeIndexer/1.0' },
});
// Extract commit SHA from Content-Disposition header: "attachment; filename=owner-repo-{sha}.tar.gz"
const headSha = parseCommitSha(res.headers.get('content-disposition'));

// Stream directly into tar extraction — strip top-level dir GitHub adds
await pipeline(Readable.fromWeb(res.body), tar.extract({ cwd: destDir, strip: 1 }));
```

**`strip: 1`** removes the `owner-repo-sha/` wrapper directory. Files extract directly into `/tmp/{repoId}/`.

Also save the tarball to disk for R2 upload:
```typescript
// Tee the stream: one to extraction, one to file for R2 upload
```
Or: download to file first, then extract. Simpler and the tarball is small.

Set repo `status = 'indexing'`.

### Step 4: Walk files

```typescript
const files = await walkFiles(`/tmp/${repoId}`, { useGit: false });
```

**Critical**: pass `useGit: false` flag. The extracted tarball is NOT a git repo — `git ls-files` will fail. `walkFiles` must use `fast-glob` fallback directly. Requires adding this flag to the `walkFiles` API.

If `files.length === 0` → set status `ready`, fileCount 0, chunkCount 0, return early. (Valid for empty repos or all-binary repos.)

### Step 5-7: Streaming pipeline (chunk → embed → upsert per batch)

**Not all-at-once.** Process files in batches to bound memory:

```typescript
const BATCH_SIZE = 50; // files per batch

for (let i = 0; i < files.length; i += BATCH_SIZE) {
  const batch = files.slice(i, i + BATCH_SIZE);

  // Chunk this batch
  const chunks: Chunk[] = [];
  for (const file of batch) {
    chunks.push(...await chunkFile(file));
  }
  if (chunks.length === 0) continue;

  // Embed this batch
  const vectors = await embedChunks(chunks);

  // Build upsert points with DETERMINISTIC IDs
  const points: UpsertPoint[] = chunks.map((chunk, j) => {
    const chunkHash = hashString(chunk.content);
    return {
      // Deterministic ID: UUID v5 from repoId + chunkHash
      // Ensures idempotency — re-indexing overwrites, doesn't duplicate
      id: uuidv5(`${repoId}:${chunkHash}`, NAMESPACE_UUID),
      embedding: vectors[j],
      payload: {
        repo_id: repoId,
        content: chunk.content,
        filePath: path.relative(cloneDir, chunk.filePath),
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        language: chunk.language,
        chunkHash,
      },
    };
  });

  // Upsert to Qdrant
  const qdrantIds = await upsertPoints(points);

  // Write chunkCache rows (for sync-repo deletion lookup)
  for (let k = 0; k < chunks.length; k++) {
    await db.insert(chunkCache).values({
      repoId,
      chunkHash: points[k].payload.chunkHash,
      qdrantId: qdrantIds[k],
      filePath: points[k].payload.filePath,
      lineStart: chunks[k].lineStart,
      lineEnd: chunks[k].lineEnd,
    }).onConflictDoUpdate({
      target: [chunkCache.repoId, chunkCache.chunkHash],
      set: { qdrantId: qdrantIds[k], filePath: points[k].payload.filePath },
    });
  }

  totalChunks += chunks.length;
}
```

**Why batches of 50 files:**
- 50 files × ~15 chunks/file = ~750 chunks × ~500 tokens = ~375K tokens per embed call
- Well within OpenAI's 1M TPM limit
- Memory: ~750 chunks in memory at once, not 50K
- Qdrant upsert: ~750 points per batch, handled by existing 100-point sub-batching

### Step 8: Persist Merkle state

```typescript
const storage = new DrizzleSyncStorage(db, repoId);
const result = await computeChanges(files, cloneDir, storage);
await persistMerkleState(files, result.fileHashMap, new Set(files), cloneDir, storage);
```

**Known limitation:** `DrizzleSyncStorage.transaction()` is a no-op (Neon HTTP doesn't support multi-statement transactions). `clearDirHashes()` followed by `setDirHash()` calls is not atomic. If the task dies between clear and write, dir hashes are empty. Recovery: next sync treats every directory as changed and re-indexes all files. Expensive but not data-corrupting.

### Step 9: Upload to R2

```typescript
// 1. Upload tarball
await r2.upload(`repos/${repoId}/repo.tar.gz`, tarballBuffer);

// 2. Build and upload file tree
const fileTree = buildFileTree(files, cloneDir);
await r2.upload(`repos/${repoId}/file-tree.json`, JSON.stringify(fileTree));

// 3. Upload individual files with bounded concurrency
const UPLOAD_CONCURRENCY = 20;
for (let i = 0; i < files.length; i += UPLOAD_CONCURRENCY) {
  const batch = files.slice(i, i + UPLOAD_CONCURRENCY);
  await Promise.all(batch.map(async (file) => {
    const relativePath = path.relative(cloneDir, file);
    const content = await fs.readFile(file);
    await r2.upload(`repos/${repoId}/files/${relativePath}`, content);
  }));
}
```

R2 uses `@aws-sdk/client-s3` with `region: "auto"` and R2 endpoint.

### Step 10: Update repo

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

Update `indexJobs`: `status = 'completed'`, `filesChanged`, `chunksEmbedded`, `completedAt`.

Check `queuedSha` on the `indexJobs` record — if set, trigger `sync-repo` for that SHA.

### Step 11: Cleanup (finally block)

```typescript
await fs.rm(`/tmp/${repoId}`, { recursive: true, force: true });
await fs.rm(`/tmp/${repoId}.tar.gz`, { force: true });
```

### Error handling

On ANY error during steps 1-10:
```sql
UPDATE repos SET status = 'error', index_error = $errorMessage
UPDATE index_jobs SET status = 'failed', error = $errorMessage, completed_at = now()
```
Cleanup still runs (finally block). The user sees "Error" status on dashboard with the error message.

## 6. sync-repo Task (incremental re-indexing)

Triggered by `push` webhook. Reuses most of `index-repo` with key differences:

1. Downloads fresh tarball of the pushed branch
2. Uses `computeChanges()` with existing Merkle state → gets `{ added, modified, deleted }`
3. Only chunks + embeds files in `added` and `modified` lists
4. Deletes Qdrant vectors for `deleted` files using `chunkCache` lookup:
   ```typescript
   const oldChunks = await db.query.chunkCache.findMany({
     where: and(eq(chunkCache.repoId, repoId), inArray(chunkCache.filePath, deleted)),
   });
   await deletePoints(oldChunks.map(c => c.qdrantId));
   await db.delete(chunkCache).where(inArray(chunkCache.id, oldChunks.map(c => c.id)));
   ```
5. Re-persists Merkle state with `successfulFiles = new Set([...added, ...modified])`
6. Re-uploads changed files to R2 (not the tarball — only changed individual files)

**Guards:**
- If `index-repo` is running: store push SHA in `indexJobs.queuedSha`, skip
- Multiple rapid pushes: only the latest `queuedSha` is stored (last writer wins). Missing middle commits is acceptable — we only care about HEAD state.
- If `sync-repo` fails: set `indexJobs.status = 'failed'`. Repo stays `ready` with stale data (not `error`). Next push will trigger a fresh sync.

## 7. DrizzleSyncStorage

Implements `SyncStorage` interface from `packages/core`, scoped by `repoId`. All methods use Drizzle ORM queries against `fileHashes` and `dirHashes` tables.

See section 5 for the full implementation. Key points:
- All writes use `onConflictDoUpdate` for idempotency
- `transaction()` is a no-op (Neon HTTP limitation — documented above)
- `getAllFileHashes()` returns a Map for O(1) lookups

## 8. Modifications to Existing Code

### packages/core/src/config/env.ts
- Remove `dotenv.config()` import and call — library should not load `.env` files (push to CLI entrypoint only)
- Replace `process.exit(1)` with `throw new Error()` — library should never exit the process

### packages/core/src/lib/store.ts
- Add `repo_id: string` and `content: string` to `PointPayload` interface
- Accept optional `id: string` in `UpsertPoint` for deterministic point IDs
- Add `repoId` filter parameter to `searchPoints()` and `deletePoints()`
- Add payload index creation for `repo_id` field in `ensureCollection()`:
  ```
  PUT /collections/{name}/index { "field_name": "repo_id", "field_schema": "keyword" }
  ```

### packages/core/src/lib/walker.ts
- Add `options?: { useGit?: boolean }` parameter to `walkFiles()`
- When `useGit: false`, skip `git ls-files` and go directly to fast-glob fallback

### apps/web/src/app/api/webhooks/github/route.ts
- After `upsertRepos()`, trigger `index-repo` task for each new repo
- Add idempotency: check `indexJobs` before triggering
- Handle `push` event: trigger `sync-repo` task

### turbo.json
Add to build env array: `QDRANT_URL`, `QDRANT_KEY`, `OPENAI_API_KEY`, `EMBEDDING_PROVIDER`, `GITHUB_APP_WEBHOOK_SECRET`, `TRIGGER_SECRET_KEY`, `R2_ENDPOINT`, `R2_BUCKET`.

## 9. Dependencies (new packages)

```bash
# apps/trigger
@trigger.dev/sdk        # Trigger.dev task runtime
@aws-sdk/client-s3      # R2 uploads (S3-compatible)
tar                     # Tarball extraction
uuid                    # UUID v5 for deterministic point IDs
@codeindexer/core       # Chunker, embedder, store, sync, walker
@codeindexer/db         # Drizzle schema + client
```

JWT generation uses `node:crypto` — zero external deps.

## 10. Cost Analysis

### Per-repo cost (medium repo: 200 files, ~2,400 chunks, ~840K tokens)

| Service | Usage | Cost |
|---------|-------|------|
| GitHub API | 2 calls (token + tarball) | $0 |
| OpenAI Embeddings | ~840K tokens | $0.017 |
| Qdrant Cloud | ~2,400 vectors stored | $0 (free: ~100K vectors) |
| Cloudflare R2 | ~20MB stored | $0 (free: 10GB) |
| Trigger.dev | 1 run, ~60s | $0 (free: 50K runs/month) |

### Free tier limits

| Service | Free limit | ~Repos before paid |
|---------|-----------|-------------------|
| Qdrant | ~100K vectors (1GB RAM) | ~40 medium repos |
| R2 | 10GB storage | ~500 small repos |
| Trigger.dev | 50K runs/month | Effectively unlimited |
| OpenAI | Pay per use ($0.02/1M tokens) | $1 for ~60 repos |

## 11. Prerequisites

| Service | Action | Env var |
|---------|--------|---------|
| Trigger.dev | Sign up → create project | `TRIGGER_SECRET_KEY` |
| Qdrant Cloud | Create free cluster | `QDRANT_URL`, `QDRANT_KEY` |
| OpenAI | Get API key | `OPENAI_API_KEY` |
| Cloudflare R2 | Create bucket + API token | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT` |

## 12. Build Order

1. Fix `env.ts` — remove dotenv, throw instead of exit
2. Extend `walker.ts` — add `useGit` flag
3. Extend `store.ts` — repo_id payload, deterministic IDs, filters, payload index
4. Scaffold `apps/trigger/` package
5. Implement `DrizzleSyncStorage`
6. Implement `lib/github.ts` — JWT, token, tarball download+extract
7. Implement `lib/r2.ts` — S3 client for R2, upload helpers
8. Implement `index-repo` task — wires everything together
9. Wire webhook → task trigger (with idempotency guard)
10. Test end-to-end with a real repo
11. Implement `sync-repo` task
12. Wire push webhook → sync-repo trigger

## 13. Review Findings Addressed (v2)

| # | Finding | Resolution |
|---|---------|------------|
| 1 | Random UUIDs break idempotency | Deterministic UUID v5 from `repoId + chunkHash` |
| 2 | chunkCache never written | Added chunkCache writes after each upsert batch |
| 3 | `git ls-files` fails on tarball | Added `useGit: false` flag to `walkFiles` |
| 4 | Tarball prefix stripping unspecified | Explicit `tar.extract({ strip: 1 })` |
| 5 | All chunks in memory — OOM | Streaming batched pipeline (50 files per batch) |
| 6 | No duplicate task guard | idempotency check via `indexJobs` status |
| 7 | `headSha` never captured | Extract from `Content-Disposition` header |
| 8 | Sequential R2 uploads | Bounded concurrency (20 parallel uploads) |
| 9 | `dotenv.config()` in library | Removed, pushed to CLI entrypoint |
| 10 | `vector` vs `embedding` field name | Fixed to use `embedding` (matches `UpsertPoint`) |
| 11 | `transaction()` no-op risk | Documented with specific recovery behavior |
| 12 | `queuedSha` on wrong table | Clarified: stored on `indexJobs`, not `repos` |
| 13 | sync-repo underspecified | Expanded with deletion logic, guards, failure behavior |
