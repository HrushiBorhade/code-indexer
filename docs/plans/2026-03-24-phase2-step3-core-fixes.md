# Phase 2 Step 3A: Core Library Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix packages/core so it can be imported by Trigger.dev workers without crashing — remove process.exit, remove dotenv auto-loading, add useGit flag to walker, extend store.ts for multi-tenant Qdrant.

**Architecture:** Three focused changes to packages/core that unblock the indexing pipeline. Each is independent and testable.

**Tech Stack:** TypeScript, Vitest, Qdrant REST API, fast-glob

**Spec:** `docs/specs/2026-03-24-phase2-step3-index-repo-design.md` (sections 8, 12.1-3)

---

### Task 1: Fix env.ts — remove dotenv and process.exit

**Files:**

- Modify: `packages/core/src/config/env.ts`

- [ ] **Step 1: Read current env.ts**

Read `packages/core/src/config/env.ts` to understand what it does. Note: it calls `dotenv.config()` at import time and `process.exit(1)` on validation failure.

- [ ] **Step 2: Remove dotenv import and config call**

Remove `import 'dotenv/config'` or `import { config } from 'dotenv'` and any `config()` call. The CLI entrypoint (`src/index.ts` or the commander file) should load dotenv, not the library.

- [ ] **Step 3: Replace process.exit(1) with throw**

Change `process.exit(1)` to `throw new Error('...')` with the same error message. A library should never kill the process.

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @codeindexer/core typecheck
```

Expected: PASS

- [ ] **Step 5: Run all tests (excluding slow embedder)**

```bash
pnpm --filter @codeindexer/core exec vitest run --exclude src/lib/embedder.test.ts
```

Expected: 132 tests pass. If env validation fails in tests, the test setup may need to set the required env vars.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config/env.ts
git commit -m "fix: remove dotenv auto-load and process.exit from env.ts"
```

---

### Task 2: Add useGit flag to walker.ts

**Files:**

- Modify: `packages/core/src/lib/walker.ts`
- Modify: `packages/core/src/lib/walker.test.ts` (add test for useGit: false)

- [ ] **Step 1: Read current walker.ts**

Read `packages/core/src/lib/walker.ts`. Note: `walkFiles(rootDir)` first tries `git ls-files`, falls back to fast-glob on failure.

- [ ] **Step 2: Write test for useGit: false**

Add a test to `walker.test.ts`:

```typescript
it('walks files without git when useGit is false', async () => {
  // Create a temp dir (NOT a git repo) with some .ts files
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'walker-nogit-'));
  await fs.writeFile(path.join(tmpDir, 'index.ts'), 'export const a = 1;');
  await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
  await fs.writeFile(path.join(tmpDir, 'src', 'lib.ts'), 'export const b = 2;');

  const files = await walkFiles(tmpDir, { useGit: false });
  expect(files).toHaveLength(2);
  expect(files.some((f) => f.endsWith('index.ts'))).toBe(true);
  expect(files.some((f) => f.endsWith('lib.ts'))).toBe(true);

  await fs.rm(tmpDir, { recursive: true });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @codeindexer/core exec vitest run src/lib/walker.test.ts
```

Expected: FAIL — `walkFiles` doesn't accept options parameter yet.

- [ ] **Step 4: Add options parameter to walkFiles**

In `walker.ts`, change the signature:

```typescript
interface WalkOptions {
  useGit?: boolean;
}

async function walkFiles(rootDir: string, options?: WalkOptions): Promise<string[]> {
```

When `options?.useGit === false`, skip the `git ls-files` attempt and go directly to the fast-glob fallback.

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @codeindexer/core exec vitest run src/lib/walker.test.ts
```

Expected: ALL walker tests pass (existing + new).

- [ ] **Step 6: Run typecheck**

```bash
pnpm --filter @codeindexer/core typecheck
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/lib/walker.ts packages/core/src/lib/walker.test.ts
git commit -m "feat: add useGit option to walkFiles for non-git directories"
```

---

### Task 3: Extend store.ts for multi-tenant Qdrant

**Files:**

- Modify: `packages/core/src/lib/store.ts`
- Modify: `packages/core/src/lib/store.test.ts`

- [ ] **Step 1: Read current store.ts**

Read `packages/core/src/lib/store.ts`. Note the current `PointPayload` interface, `UpsertPoint` type, `upsertPoints`, `searchPoints`, `deletePoints`, and `ensureCollection` functions.

- [ ] **Step 2: Add repo_id and content to PointPayload**

```typescript
interface PointPayload {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  language: string;
  chunkHash: string;
  // New fields for multi-tenancy
  repo_id?: string;
  content?: string;
}
```

Make them optional so existing CLI usage doesn't break.

- [ ] **Step 3: Accept optional id in UpsertPoint**

```typescript
interface UpsertPoint {
  id?: string; // Deterministic ID (UUID v5). If omitted, random UUID generated.
  embedding: number[];
  payload: PointPayload;
}
```

In `upsertPoints`, use `point.id ?? randomUUID()` instead of always `randomUUID()`.

- [ ] **Step 4: Add repoId filter to searchPoints**

Add optional `repoId?: string` parameter. When provided, add Qdrant filter:

```typescript
filter: repoId
  ? {
      must: [{ key: 'repo_id', match: { value: repoId } }],
    }
  : undefined;
```

- [ ] **Step 5: Add repoId filter to deletePoints**

Same pattern — accept optional `repoId` for filtered deletion, or accept point IDs directly.

- [ ] **Step 6: Add payload index creation to ensureCollection**

After creating the collection, create a keyword payload index on `repo_id`:

```typescript
await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/index`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'api-key': QDRANT_KEY },
  body: JSON.stringify({ field_name: 'repo_id', field_schema: 'keyword' }),
});
```

- [ ] **Step 7: Run existing store tests**

```bash
pnpm --filter @codeindexer/core exec vitest run src/lib/store.test.ts
```

Expected: ALL existing tests pass (optional fields don't break them).

- [ ] **Step 8: Run typecheck**

```bash
pnpm --filter @codeindexer/core typecheck
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/lib/store.ts packages/core/src/lib/store.test.ts
git commit -m "feat: extend store.ts for multi-tenant Qdrant (repo_id, deterministic IDs, filters)"
```

---

### Task 4: Update exports and run full checks

**Files:**

- Modify: `packages/core/src/index.ts` (if new exports needed)

- [ ] **Step 1: Verify barrel exports include new types**

Check `packages/core/src/index.ts` exports `WalkOptions` type if needed.

- [ ] **Step 2: Run format + typecheck + lint**

```bash
pnpm format
pnpm --filter @codeindexer/core typecheck
pnpm --filter @codeindexer/core lint
```

Expected: ALL pass

- [ ] **Step 3: Run all core tests**

```bash
pnpm --filter @codeindexer/core exec vitest run --exclude src/lib/embedder.test.ts
```

Expected: 132+ tests pass

- [ ] **Step 4: Push and create PR**

```bash
git push -u origin phase-2/core-fixes
gh pr create --title "fix: core library fixes for Trigger.dev compatibility" --base main
```
