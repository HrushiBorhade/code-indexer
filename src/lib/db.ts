import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('db');

const DEFAULT_DB_DIR = '.code-indexer';
const DB_FILENAME = 'cache.db';

let db: Database.Database | null = null;
let initializedRootDir: string | null = null;

interface FileHashRow {
  file_path: string;
  sha256: string;
  updated_at: number;
}

interface ChunkCacheRow {
  chunk_hash: string;
  qdrant_id: string;
  file_path: string;
  line_start: number;
  line_end: number;
}

function getDbPath(rootDir: string): string {
  return path.join(rootDir, DEFAULT_DB_DIR, DB_FILENAME);
}

function initDb(rootDir: string): Database.Database {
  if (db) {
    if (initializedRootDir && initializedRootDir !== rootDir) {
      throw new Error(
        `Database already initialized for "${initializedRootDir}", cannot reinitialize for "${rootDir}". Call closeDb() first.`,
      );
    }
    return db;
  }

  const dbPath = getDbPath(rootDir);

  // Ensure the .code-indexer directory exists (recursive mkdir is a no-op if it already exists)
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  try {
    db = new Database(dbPath);

    db.pragma('journal_mode = WAL');

    db.exec(`
      CREATE TABLE IF NOT EXISTS file_hashes (
        file_path TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunk_cache (
        chunk_hash TEXT PRIMARY KEY,
        qdrant_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chunk_cache_file_path
        ON chunk_cache(file_path);
    `);
  } catch (err: unknown) {
    // Clean up partial state so next initDb attempt doesn't return a broken instance
    db?.close();
    db = null;
    initializedRootDir = null;
    throw err;
  }

  initializedRootDir = rootDir;
  log.info(`SQLite database initialized at ${dbPath}`);
  return db;
}

function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb(rootDir) first.');
  }
  return db;
}

// --- file_hashes operations ---

function getFileHash(filePath: string): FileHashRow | undefined {
  const row = getDb().prepare('SELECT * FROM file_hashes WHERE file_path = ?').get(filePath);
  return row as FileHashRow | undefined;
}

function setFileHash(filePath: string, sha256: string): void {
  getDb()
    .prepare(
      `INSERT INTO file_hashes (file_path, sha256, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET sha256 = excluded.sha256, updated_at = excluded.updated_at`,
    )
    .run(filePath, sha256, Date.now());
}

function deleteFileHash(filePath: string): void {
  getDb().prepare('DELETE FROM file_hashes WHERE file_path = ?').run(filePath);
}

function getAllFileHashes(): FileHashRow[] {
  const rows = getDb().prepare('SELECT * FROM file_hashes').all();
  return rows as FileHashRow[];
}

// --- chunk_cache operations ---

function getChunksByFile(filePath: string): ChunkCacheRow[] {
  const rows = getDb().prepare('SELECT * FROM chunk_cache WHERE file_path = ?').all(filePath);
  return rows as ChunkCacheRow[];
}

function upsertChunk(
  chunkHash: string,
  qdrantId: string,
  filePath: string,
  lineStart: number,
  lineEnd: number,
): void {
  getDb()
    .prepare(
      `INSERT INTO chunk_cache (chunk_hash, qdrant_id, file_path, line_start, line_end)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(chunk_hash) DO UPDATE SET
         qdrant_id = excluded.qdrant_id,
         file_path = excluded.file_path,
         line_start = excluded.line_start,
         line_end = excluded.line_end`,
    )
    .run(chunkHash, qdrantId, filePath, lineStart, lineEnd);
}

function deleteChunksByFile(filePath: string): ChunkCacheRow[] {
  const db = getDb();
  const txn = db.transaction(() => {
    const chunks = db
      .prepare('SELECT * FROM chunk_cache WHERE file_path = ?')
      .all(filePath) as ChunkCacheRow[];
    db.prepare('DELETE FROM chunk_cache WHERE file_path = ?').run(filePath);
    return chunks;
  });
  return txn();
}

// --- lifecycle ---

function closeDb(): void {
  if (db) {
    try {
      db.close();
    } catch (err: unknown) {
      log.warn(`Error closing database: ${err instanceof Error ? err.message : err}`);
    }
    db = null;
    initializedRootDir = null;
    log.info('SQLite database closed');
  }
}

export {
  initDb,
  getDb,
  closeDb,
  getDbPath,
  getFileHash,
  setFileHash,
  deleteFileHash,
  getAllFileHashes,
  getChunksByFile,
  upsertChunk,
  deleteChunksByFile,
};
export type { FileHashRow, ChunkCacheRow };
