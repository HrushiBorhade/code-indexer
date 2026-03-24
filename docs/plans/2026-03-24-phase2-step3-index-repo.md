# Phase 2 Step 3B: Trigger.dev index-repo Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the index-repo Trigger.dev task that clones a GitHub repo via tarball, chunks code with web-tree-sitter, embeds with OpenAI, stores vectors in Qdrant, persists Merkle state in Neon, uploads files to R2, and wires it to the webhook handler.

**Architecture:** `apps/trigger` is a new Turborepo package. The task uses `@codeindexer/core` (chunker, embedder, store, sync) and `@codeindexer/db` (Drizzle schema). External services: GitHub API, OpenAI, Qdrant Cloud, Cloudflare R2.

**Tech Stack:** Trigger.dev SDK v4, @aws-sdk/client-s3, tar, uuid, node:crypto

**Spec:** `docs/specs/2026-03-24-phase2-step3-index-repo-design.md`
**Depends on:** Plan A (core fixes) must be merged first.

---

### Task 1: Scaffold apps/trigger package

**Files:**

- Create: `apps/trigger/package.json`
- Create: `apps/trigger/tsconfig.json`
- Create: `apps/trigger/trigger.config.ts`
- Create: `apps/trigger/src/tasks/.gitkeep`
- Create: `apps/trigger/src/lib/.gitkeep`
- Modify: `turbo.json` (add env vars)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@codeindexer/trigger",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "npx trigger.dev@latest dev",
    "deploy": "npx trigger.dev@latest deploy",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@trigger.dev/sdk": "^4.0.0",
    "@aws-sdk/client-s3": "^3.0.0",
    "@codeindexer/core": "workspace:*",
    "@codeindexer/db": "workspace:*",
    "tar": "^7.0.0",
    "uuid": "^11.0.0"
  },
  "devDependencies": {
    "@trigger.dev/build": "^4.0.0",
    "@codeindexer/tsconfig": "workspace:*",
    "@types/tar": "^6.0.0",
    "@types/uuid": "^10.0.0",
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "@codeindexer/tsconfig/library.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "esnext",
    "moduleResolution": "bundler"
  },
  "include": ["src/**/*", "trigger.config.ts"]
}
```

- [ ] **Step 3: Create trigger.config.ts**

```typescript
import { defineConfig } from '@trigger.dev/sdk';

export default defineConfig({
  project: '<project-ref>', // Fill after creating Trigger.dev project
  dirs: ['./src/tasks'],
  runtime: 'node',
  defaultMachine: 'small-2x', // 1 vCPU, 1GB RAM
  maxDuration: 300, // 5 minutes
  retries: {
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30000,
      factor: 2,
    },
  },
  build: {
    external: ['web-tree-sitter', 'better-sqlite3', 'tree-sitter-wasms'],
  },
});
```

- [ ] **Step 4: Create directory structure**

```bash
mkdir -p apps/trigger/src/tasks apps/trigger/src/lib
touch apps/trigger/src/tasks/.gitkeep apps/trigger/src/lib/.gitkeep
```

- [ ] **Step 5: Update turbo.json env array**

Add to the `build.env` array: `QDRANT_URL`, `QDRANT_KEY`, `OPENAI_API_KEY`, `EMBEDDING_PROVIDER`, `TRIGGER_SECRET_KEY`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`.

- [ ] **Step 6: Install dependencies**

```bash
pnpm install
pnpm --filter @codeindexer/trigger typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/trigger/ turbo.json pnpm-lock.yaml
git commit -m "chore: scaffold apps/trigger package for Trigger.dev"
```

---

### Task 2: Implement lib/github.ts — JWT + token + tarball

**Files:**

- Create: `apps/trigger/src/lib/github.ts`

- [ ] **Step 1: Create github.ts with JWT generation**

Use `node:crypto` for zero-dep JWT signing:

```typescript
import { createSign, createPrivateKey } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { extract } from 'tar';

function createAppJWT(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }),
  ).toString('base64url');
  const key = createPrivateKey(privateKey);
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(key, 'base64url');
  return `${header}.${payload}.${signature}`;
}

async function getInstallationToken(installationId: number, appJwt: string): Promise<string> {
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'CodeIndexer/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!res.ok) throw new Error(`Failed to get installation token: ${res.status}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function downloadAndExtractTarball(
  fullName: string,
  ref: string,
  token: string,
  destDir: string,
  tarballPath: string,
): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${fullName}/tarball/${ref}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'CodeIndexer/1.0',
    },
  });
  if (!res.ok) throw new Error(`Tarball download failed: ${res.status}`);

  // Extract commit SHA from Content-Disposition header
  const disposition = res.headers.get('content-disposition') ?? '';
  const shaMatch = disposition.match(/filename=.*-([a-f0-9]{7,40})\.tar\.gz/);
  const headSha = shaMatch?.[1] ?? 'unknown';

  // Save tarball to disk (for R2 upload later)
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tarballPath));

  // Extract tarball with strip: 1 to remove GitHub's wrapper directory
  await mkdir(destDir, { recursive: true });
  await extract({ file: tarballPath, cwd: destDir, strip: 1 });

  return headSha;
}

export { createAppJWT, getInstallationToken, downloadAndExtractTarball };
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @codeindexer/trigger typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/trigger/src/lib/github.ts
git commit -m "feat: add GitHub App JWT, installation token, and tarball download"
```

---

### Task 3: Implement lib/r2.ts — R2 upload helpers

**Files:**

- Create: `apps/trigger/src/lib/r2.ts`

- [ ] **Step 1: Create r2.ts**

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function createR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

const BUCKET = () => process.env.R2_BUCKET!;

async function uploadBuffer(key: string, body: Buffer, contentType = 'application/octet-stream') {
  const client = createR2Client();
  await client.send(
    new PutObjectCommand({ Bucket: BUCKET(), Key: key, Body: body, ContentType: contentType }),
  );
}

async function uploadFile(key: string, filePath: string) {
  const body = await readFile(filePath);
  await uploadBuffer(key, body);
}

async function uploadRepoFiles(
  repoId: string,
  files: string[],
  cloneDir: string,
  concurrency = 20,
) {
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (file) => {
        const relativePath = path.relative(cloneDir, file);
        await uploadFile(`repos/${repoId}/files/${relativePath}`, file);
      }),
    );
  }
}

function buildFileTree(files: string[], cloneDir: string): object {
  const tree: Record<string, any> = {};
  for (const file of files) {
    const rel = path.relative(cloneDir, file);
    const parts = rel.split(path.sep);
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      node[parts[i]] = node[parts[i]] || {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = null; // leaf = file
  }
  return tree;
}

export { uploadBuffer, uploadFile, uploadRepoFiles, buildFileTree, createR2Client };
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @codeindexer/trigger typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/trigger/src/lib/r2.ts
git commit -m "feat: add R2 upload helpers using @aws-sdk/client-s3"
```

---

### Task 4: Implement DrizzleSyncStorage

**Files:**

- Create: `apps/trigger/src/lib/drizzle-sync-storage.ts`

- [ ] **Step 1: Create drizzle-sync-storage.ts**

Implements the `SyncStorage` interface from `@codeindexer/core`, scoped by `repoId`. Uses Drizzle ORM queries against the `fileHashes` and `dirHashes` tables in `@codeindexer/db`.

See spec section 7 for the full implementation. Key method signatures:

- `constructor(db: Database, repoId: string)`
- `getFileHash(filePath)` → SELECT from fileHashes
- `setFileHash(filePath, hash)` → INSERT ON CONFLICT UPDATE
- `getDirHash(dirPath)` → SELECT from dirHashes
- `setDirHash(dirPath, hash)` → INSERT ON CONFLICT UPDATE
- `clearDirHashes()` → DELETE WHERE repoId
- `getAllFileHashes()` → SELECT all, return Map
- `transaction(fn)` → just call fn() (Neon HTTP limitation)

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @codeindexer/trigger typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/trigger/src/lib/drizzle-sync-storage.ts
git commit -m "feat: add DrizzleSyncStorage for Neon Postgres Merkle state"
```

---

### Task 5: Implement index-repo task

**Files:**

- Create: `apps/trigger/src/tasks/index-repo.ts`

- [ ] **Step 1: Create index-repo.ts**

This is the main task. It wires together all the pieces:

1. Load repo from DB, set status 'cloning'
2. Generate installation token via `lib/github.ts`
3. Download + extract tarball
4. Walk files with `useGit: false`
5. Batched pipeline: chunk → embed → upsert → chunkCache (50 files/batch)
6. Persist Merkle state via DrizzleSyncStorage
7. Upload to R2 (tarball + file-tree + individual files)
8. Update repo status to 'ready'
9. Cleanup in finally block

Use `schemaTask()` with Zod input validation:

```typescript
import { schemaTask } from '@trigger.dev/sdk';
import { z } from 'zod';
```

Deterministic point IDs: `uuidv5(repoId + ':' + chunkHash, NAMESPACE)`.

Error handling: try/catch/finally — set status 'error' on failure, always cleanup /tmp.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @codeindexer/trigger typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/trigger/src/tasks/index-repo.ts
git commit -m "feat: implement index-repo Trigger.dev task"
```

---

### Task 6: Wire webhook → task trigger

**Files:**

- Modify: `apps/web/src/app/api/webhooks/github/route.ts`
- Modify: `apps/web/package.json` (add @trigger.dev/sdk)

- [ ] **Step 1: Install Trigger.dev SDK in web app**

```bash
pnpm --filter @codeindexer/web add @trigger.dev/sdk
```

- [ ] **Step 2: Add task trigger after upsertRepos**

In the webhook handler, after `upsertRepos()` completes for `installation.created` and `installation_repositories.added`, trigger the task:

```typescript
import { tasks } from '@trigger.dev/sdk';
import type { indexRepoTask } from '@codeindexer/trigger/tasks/index-repo';

// After each repo is upserted:
await tasks.trigger<typeof indexRepoTask>(
  'index-repo',
  {
    repoId: repo.id,
  },
  {
    idempotencyKey: `index-${repo.id}`,
  },
);
```

Use `idempotencyKey` for built-in dedup (Trigger.dev native feature).

- [ ] **Step 3: Add TRIGGER_SECRET_KEY to apps/web/.env.local**

```
TRIGGER_SECRET_KEY=<from Trigger.dev dashboard>
```

- [ ] **Step 4: Typecheck web app**

```bash
pnpm --filter @codeindexer/web typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/webhooks/github/route.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat: wire webhook to trigger index-repo task"
```

---

### Task 7: End-to-end test

- [ ] **Step 1: Set up all env vars**

Ensure `apps/trigger/.env` and `apps/web/.env.local` have:

- `TRIGGER_SECRET_KEY`
- `QDRANT_URL`, `QDRANT_KEY`
- `OPENAI_API_KEY`
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`
- `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`
- `DATABASE_URL`

- [ ] **Step 2: Start Trigger.dev dev**

```bash
cd apps/trigger && npx trigger.dev@latest dev
```

- [ ] **Step 3: Start web dev + smee**

```bash
pnpm dev:web
npx smee -u https://smee.io/WWmyHci3wq1ucqx --target http://localhost:3000/api/webhooks/github
```

- [ ] **Step 4: Install GitHub App on one test repo**

Go to dashboard → Add Repository → select ONE small repo.

- [ ] **Step 5: Verify the flow**

- Webhook received → repo created in DB with status 'pending'
- index-repo task triggered (check Trigger.dev dashboard)
- Status transitions: pending → cloning → indexing → ready
- Dashboard shows repo with "Ready" badge, file/chunk counts
- Qdrant has vectors with repo_id filter
- R2 has tarball + file-tree.json + individual files

- [ ] **Step 6: Run all checks**

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
```

- [ ] **Step 7: Create PR**

```bash
git push -u origin phase-2/index-repo
gh pr create --title "feat: Trigger.dev index-repo task with R2 storage" --base main
```
