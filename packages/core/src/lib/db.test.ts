import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  initDb,
  closeDb,
  getFileHash,
  setFileHash,
  deleteFileHash,
  getAllFileHashes,
  getChunksByFile,
  upsertChunk,
  deleteChunksByFile,
} from './db.ts';

describe('db', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-test-'));
    initDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
  });

  describe('initDb', () => {
    it('creates the .code-indexer directory and cache.db file', async () => {
      const dbPath = path.join(tmpDir, '.code-indexer', 'cache.db');
      const stat = await fs.stat(dbPath);
      expect(stat.isFile()).toBe(true);
    });

    it('returns the same instance on second call', () => {
      const db1 = initDb(tmpDir);
      const db2 = initDb(tmpDir);
      expect(db1).toBe(db2);
    });
  });

  describe('file_hashes', () => {
    it('returns undefined for unknown file', () => {
      expect(getFileHash('/unknown/file.ts')).toBeUndefined();
    });

    it('sets and gets a file hash', () => {
      setFileHash('/src/index.ts', 'abc123');

      const row = getFileHash('/src/index.ts');
      expect(row).toBeDefined();
      expect(row!.sha256).toBe('abc123');
      expect(row!.file_path).toBe('/src/index.ts');
      expect(row!.updated_at).toBeGreaterThan(0);
    });

    it('updates hash on conflict (same file path)', () => {
      setFileHash('/src/index.ts', 'hash-v1');
      setFileHash('/src/index.ts', 'hash-v2');

      const row = getFileHash('/src/index.ts');
      expect(row!.sha256).toBe('hash-v2');
    });

    it('deletes a file hash', () => {
      setFileHash('/src/index.ts', 'abc123');
      deleteFileHash('/src/index.ts');

      expect(getFileHash('/src/index.ts')).toBeUndefined();
    });

    it('delete is a no-op for non-existent file', () => {
      expect(() => deleteFileHash('/missing.ts')).not.toThrow();
    });

    it('gets all file hashes', () => {
      setFileHash('/src/a.ts', 'hash-a');
      setFileHash('/src/b.ts', 'hash-b');
      setFileHash('/src/c.ts', 'hash-c');

      const all = getAllFileHashes();
      expect(all).toHaveLength(3);
      expect(all.map((r) => r.file_path).sort()).toEqual(['/src/a.ts', '/src/b.ts', '/src/c.ts']);
    });
  });

  describe('chunk_cache', () => {
    it('returns empty array for file with no chunks', () => {
      expect(getChunksByFile('/unknown.ts')).toEqual([]);
    });

    it('upserts and retrieves chunks by file', () => {
      upsertChunk('chunk-hash-1', 'qdrant-id-1', '/src/index.ts', 1, 25);
      upsertChunk('chunk-hash-2', 'qdrant-id-2', '/src/index.ts', 27, 50);

      const chunks = getChunksByFile('/src/index.ts');
      expect(chunks).toHaveLength(2);
      expect(chunks[0].chunk_hash).toBe('chunk-hash-1');
      expect(chunks[0].qdrant_id).toBe('qdrant-id-1');
      expect(chunks[0].line_start).toBe(1);
      expect(chunks[0].line_end).toBe(25);
    });

    it('updates chunk on conflict (same chunk_hash)', () => {
      upsertChunk('chunk-hash-1', 'old-id', '/src/index.ts', 1, 10);
      upsertChunk('chunk-hash-1', 'new-id', '/src/index.ts', 1, 15);

      const chunks = getChunksByFile('/src/index.ts');
      expect(chunks).toHaveLength(1);
      expect(chunks[0].qdrant_id).toBe('new-id');
      expect(chunks[0].line_end).toBe(15);
    });

    it('does not mix chunks from different files', () => {
      upsertChunk('hash-a', 'id-a', '/src/a.ts', 1, 10);
      upsertChunk('hash-b', 'id-b', '/src/b.ts', 1, 20);

      expect(getChunksByFile('/src/a.ts')).toHaveLength(1);
      expect(getChunksByFile('/src/b.ts')).toHaveLength(1);
    });

    it('deletes chunks by file and returns deleted rows', () => {
      upsertChunk('hash-1', 'qid-1', '/src/index.ts', 1, 10);
      upsertChunk('hash-2', 'qid-2', '/src/index.ts', 11, 20);
      upsertChunk('hash-3', 'qid-3', '/src/other.ts', 1, 5);

      const deleted = deleteChunksByFile('/src/index.ts');

      expect(deleted).toHaveLength(2);
      expect(deleted.map((d) => d.qdrant_id).sort()).toEqual(['qid-1', 'qid-2']);

      // Other file's chunks are untouched
      expect(getChunksByFile('/src/other.ts')).toHaveLength(1);

      // Deleted file's chunks are gone
      expect(getChunksByFile('/src/index.ts')).toEqual([]);
    });

    it('delete returns empty array when no chunks exist', () => {
      expect(deleteChunksByFile('/missing.ts')).toEqual([]);
    });
  });
});
