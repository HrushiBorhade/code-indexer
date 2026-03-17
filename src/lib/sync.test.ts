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

      const first = await computeChanges(files, tmpDir);
      persistMerkleState(first.tree, first.fileHashMap, new Set(files));

      const second = await computeChanges(files, tmpDir);
      expect(second.added).toHaveLength(0);
      expect(second.modified).toHaveLength(0);
      expect(second.deleted).toHaveLength(0);
    });

    it('detects modified file', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      const filePath = path.join(tmpDir, 'src', 'a.ts');
      await fs.writeFile(filePath, 'const a = 1;');

      const files = [filePath];
      const first = await computeChanges(files, tmpDir);
      persistMerkleState(first.tree, first.fileHashMap, new Set(files));

      await fs.writeFile(filePath, 'const a = 2;');
      const second = await computeChanges(files, tmpDir);

      expect(second.modified).toEqual([filePath]);
      expect(second.added).toHaveLength(0);
    });

    it('detects new file added', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      const fileA = path.join(tmpDir, 'src', 'a.ts');
      await fs.writeFile(fileA, 'const a = 1;');

      const first = await computeChanges([fileA], tmpDir);
      persistMerkleState(first.tree, first.fileHashMap, new Set([fileA]));

      const fileB = path.join(tmpDir, 'src', 'b.ts');
      await fs.writeFile(fileB, 'const b = 2;');

      const second = await computeChanges([fileA, fileB], tmpDir);
      expect(second.added).toEqual([fileB]);
      expect(second.modified).toHaveLength(0);
    });

    it('detects deleted file', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      const fileA = path.join(tmpDir, 'src', 'a.ts');
      const fileB = path.join(tmpDir, 'src', 'b.ts');
      await fs.writeFile(fileA, 'const a = 1;');
      await fs.writeFile(fileB, 'const b = 2;');

      const first = await computeChanges([fileA, fileB], tmpDir);
      persistMerkleState(first.tree, first.fileHashMap, new Set([fileA, fileB]));

      const second = await computeChanges([fileA], tmpDir);
      expect(second.deleted).toEqual([fileB]);
    });

    it('skips unchanged directories entirely', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'lib'), { recursive: true });
      const srcFile = path.join(tmpDir, 'src', 'a.ts');
      const libFile = path.join(tmpDir, 'lib', 'b.ts');
      await fs.writeFile(srcFile, 'const a = 1;');
      await fs.writeFile(libFile, 'const b = 2;');

      const files = [srcFile, libFile];
      const first = await computeChanges(files, tmpDir);
      persistMerkleState(first.tree, first.fileHashMap, new Set(files));

      await fs.writeFile(srcFile, 'const a = 999;');
      const second = await computeChanges(files, tmpDir);

      expect(second.modified).toEqual([srcFile]);
      expect(second.added).toHaveLength(0);
    });

    it('handles root-level files correctly', async () => {
      const rootFile = path.join(tmpDir, 'index.ts');
      await fs.writeFile(rootFile, 'console.log("hello");');

      const files = [rootFile];
      const first = await computeChanges(files, tmpDir);
      persistMerkleState(first.tree, first.fileHashMap, new Set(files));

      const second = await computeChanges(files, tmpDir);
      expect(second.added).toHaveLength(0);
      expect(second.modified).toHaveLength(0);
    });

    it('handles deeply nested directories', async () => {
      await fs.mkdir(path.join(tmpDir, 'a', 'b', 'c'), { recursive: true });
      const deepFile = path.join(tmpDir, 'a', 'b', 'c', 'deep.ts');
      await fs.writeFile(deepFile, 'const deep = true;');

      const files = [deepFile];
      const first = await computeChanges(files, tmpDir);
      persistMerkleState(first.tree, first.fileHashMap, new Set(files));

      const second = await computeChanges(files, tmpDir);
      expect(second.added).toHaveLength(0);
      expect(second.modified).toHaveLength(0);
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
    it('only persists hashes for successful files', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      const fileA = path.join(tmpDir, 'src', 'a.ts');
      const fileB = path.join(tmpDir, 'src', 'b.ts');
      await fs.writeFile(fileA, 'const a = 1;');
      await fs.writeFile(fileB, 'const b = 2;');

      const files = [fileA, fileB];
      const result = await computeChanges(files, tmpDir);

      // Only mark fileA as successful
      persistMerkleState(result.tree, result.fileHashMap, new Set([fileA]));

      await fs.writeFile(fileB, 'const b = 999;');
      const second = await computeChanges(files, tmpDir);
      expect(second.modified.length + second.added.length).toBeGreaterThanOrEqual(1);
    });
  });
});
