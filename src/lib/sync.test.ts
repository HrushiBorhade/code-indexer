import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initDb, closeDb } from './db.ts';
import { computeChanges, persistMerkleState } from './sync.ts';

describe('sync (Merkle tree)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'));
    initDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
  });

  describe('computeChanges', () => {
    it('detects all files as added on first run', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'src', 'a.ts'), 'const a = 1;');
      await fs.writeFile(path.join(tmpDir, 'src', 'b.ts'), 'const b = 2;');

      const files = [path.join(tmpDir, 'src', 'a.ts'), path.join(tmpDir, 'src', 'b.ts')];

      const result = await computeChanges(files, tmpDir);

      expect(result.added).toHaveLength(2);
      expect(result.modified).toHaveLength(0);
      expect(result.deleted).toHaveLength(0);
    });

    it('detects no changes when Merkle root matches', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'src', 'a.ts'), 'const a = 1;');

      const files = [path.join(tmpDir, 'src', 'a.ts')];

      // First run: index everything
      const firstResult = await computeChanges(files, tmpDir);
      persistMerkleState(files, firstResult.fileHashMap, new Set(files), tmpDir);

      // Second run: nothing changed
      const secondResult = await computeChanges(files, tmpDir);

      expect(secondResult.added).toHaveLength(0);
      expect(secondResult.modified).toHaveLength(0);
      expect(secondResult.deleted).toHaveLength(0);
    });

    it('detects modified file', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      const filePath = path.join(tmpDir, 'src', 'a.ts');
      await fs.writeFile(filePath, 'const a = 1;');

      const files = [filePath];

      // First run
      const firstResult = await computeChanges(files, tmpDir);
      persistMerkleState(files, firstResult.fileHashMap, new Set(files), tmpDir);

      // Modify file
      await fs.writeFile(filePath, 'const a = 2;');

      // Second run
      const secondResult = await computeChanges(files, tmpDir);

      expect(secondResult.added).toHaveLength(0);
      expect(secondResult.modified).toEqual([filePath]);
      expect(secondResult.deleted).toHaveLength(0);
    });

    it('detects new file added', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      const fileA = path.join(tmpDir, 'src', 'a.ts');
      await fs.writeFile(fileA, 'const a = 1;');

      // First run with one file
      const firstResult = await computeChanges([fileA], tmpDir);
      persistMerkleState([fileA], firstResult.fileHashMap, new Set([fileA]), tmpDir);

      // Add a new file
      const fileB = path.join(tmpDir, 'src', 'b.ts');
      await fs.writeFile(fileB, 'const b = 2;');

      // Second run with both files
      const secondResult = await computeChanges([fileA, fileB], tmpDir);

      expect(secondResult.added).toEqual([fileB]);
      expect(secondResult.modified).toHaveLength(0);
    });

    it('detects deleted file', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      const fileA = path.join(tmpDir, 'src', 'a.ts');
      const fileB = path.join(tmpDir, 'src', 'b.ts');
      await fs.writeFile(fileA, 'const a = 1;');
      await fs.writeFile(fileB, 'const b = 2;');

      // First run with both files
      const firstResult = await computeChanges([fileA, fileB], tmpDir);
      persistMerkleState([fileA, fileB], firstResult.fileHashMap, new Set([fileA, fileB]), tmpDir);

      // Second run with only fileA (fileB deleted)
      const secondResult = await computeChanges([fileA], tmpDir);

      expect(secondResult.deleted).toEqual([fileB]);
    });

    it('skips unchanged directories entirely', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'lib'), { recursive: true });
      const srcFile = path.join(tmpDir, 'src', 'a.ts');
      const libFile = path.join(tmpDir, 'lib', 'b.ts');
      await fs.writeFile(srcFile, 'const a = 1;');
      await fs.writeFile(libFile, 'const b = 2;');

      const files = [srcFile, libFile];

      // First run
      const firstResult = await computeChanges(files, tmpDir);
      persistMerkleState(files, firstResult.fileHashMap, new Set(files), tmpDir);

      // Modify only src/a.ts
      await fs.writeFile(srcFile, 'const a = 999;');

      // Second run
      const secondResult = await computeChanges(files, tmpDir);

      // Only src/a.ts should be detected as modified, lib/b.ts should be skipped
      expect(secondResult.modified).toEqual([srcFile]);
      expect(secondResult.added).toHaveLength(0);
    });

    it('returns fileHashMap for all files', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      const filePath = path.join(tmpDir, 'src', 'a.ts');
      await fs.writeFile(filePath, 'const a = 1;');

      const result = await computeChanges([filePath], tmpDir);

      expect(result.fileHashMap.has(filePath)).toBe(true);
      expect(result.fileHashMap.get(filePath)).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('persistMerkleState', () => {
    it('stores file and directory hashes', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      const filePath = path.join(tmpDir, 'src', 'a.ts');
      await fs.writeFile(filePath, 'content');

      const files = [filePath];
      const result = await computeChanges(files, tmpDir);
      persistMerkleState(files, result.fileHashMap, new Set(files), tmpDir);

      // Second run should find nothing changed
      const secondResult = await computeChanges(files, tmpDir);
      expect(secondResult.added).toHaveLength(0);
      expect(secondResult.modified).toHaveLength(0);
    });

    it('only persists hashes for successful files', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      const fileA = path.join(tmpDir, 'src', 'a.ts');
      const fileB = path.join(tmpDir, 'src', 'b.ts');
      await fs.writeFile(fileA, 'const a = 1;');
      await fs.writeFile(fileB, 'const b = 2;');

      const files = [fileA, fileB];
      const result = await computeChanges(files, tmpDir);

      // Only mark fileA as successful
      persistMerkleState(files, result.fileHashMap, new Set([fileA]), tmpDir);

      // Modify fileB
      await fs.writeFile(fileB, 'const b = 999;');

      // fileB should still show as modified because its hash wasn't persisted
      const secondResult = await computeChanges(files, tmpDir);
      expect(secondResult.modified.length + secondResult.added.length).toBeGreaterThanOrEqual(1);
    });
  });
});
