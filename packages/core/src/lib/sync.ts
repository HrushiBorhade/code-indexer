import path from 'node:path';
import { hashFile, hashString } from './hash.ts';
import {
  getDb,
  getFileHash as dbGetFileHash,
  setFileHash as dbSetFileHash,
  getAllFileHashes as dbGetAllFileHashes,
  getDirHash as dbGetDirHash,
  setDirHash as dbSetDirHash,
  clearDirHashes as dbClearDirHashes,
} from './db.ts';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('sync');

const ROOT_KEY = '__root__';
const HASH_CONCURRENCY = 32;

// ---------------------------------------------------------------------------
// SyncStorage interface — abstracts DB I/O so Merkle logic works with any backend
// ---------------------------------------------------------------------------

interface SyncStorage {
  /** Get the stored SHA-256 hash for a file, or null if not stored. */
  getFileHash(filePath: string): Promise<string | null>;

  /** Persist a file's SHA-256 hash. */
  setFileHash(filePath: string, hash: string): Promise<void>;

  /** Get the stored Merkle hash for a directory, or null if not stored. */
  getDirHash(dirPath: string): Promise<string | null>;

  /** Persist a directory's Merkle hash. */
  setDirHash(dirPath: string, hash: string): Promise<void>;

  /** Delete all stored directory hashes. */
  clearDirHashes(): Promise<void>;

  /** Get all stored file paths and their hashes. */
  getAllFileHashes(): Promise<Map<string, string>>;

  /**
   * Run a set of operations atomically. If the backend supports transactions,
   * all writes inside `fn` should be committed together or rolled back.
   * Backends without transaction support can simply run `fn` sequentially.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// SqliteSyncStorage — wraps the existing better-sqlite3 calls
// ---------------------------------------------------------------------------

class SqliteSyncStorage implements SyncStorage {
  async getFileHash(filePath: string): Promise<string | null> {
    const row = dbGetFileHash(filePath);
    return row ? row.sha256 : null;
  }

  async setFileHash(filePath: string, hash: string): Promise<void> {
    dbSetFileHash(filePath, hash);
  }

  async getDirHash(dirPath: string): Promise<string | null> {
    const row = dbGetDirHash(dirPath);
    return row ? row.merkle_hash : null;
  }

  async setDirHash(dirPath: string, hash: string): Promise<void> {
    dbSetDirHash(dirPath, hash);
  }

  async clearDirHashes(): Promise<void> {
    dbClearDirHashes();
  }

  async getAllFileHashes(): Promise<Map<string, string>> {
    const rows = dbGetAllFileHashes();
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.file_path, row.sha256);
    }
    return map;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // better-sqlite3 transactions are synchronous. Since SqliteSyncStorage
    // methods wrap sync calls in async, all awaits resolve in the same
    // microtask. We use manual BEGIN/COMMIT to support the async fn.
    const db = getDb();
    db.exec('BEGIN');
    try {
      const result = await fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Pure Merkle computation — NO storage dependency
// ---------------------------------------------------------------------------

interface SyncResult {
  added: string[];
  modified: string[];
  deleted: string[];
  fileHashMap: Map<string, string>;
  tree: MerkleTree;
}

interface MerkleTree {
  dirHashes: Map<string, string>;
  rootHash: string;
  dirToFiles: Map<string, string[]>;
}

function dirDepth(p: string): number {
  return p === '.' ? 0 : p.split('/').length;
}

function isImmediateChild(parent: string, candidate: string): boolean {
  if (candidate === parent) return false;
  const prefix = parent === '.' ? '' : parent + '/';
  const rest = candidate.startsWith(prefix) ? candidate.slice(prefix.length) : null;
  return rest !== null && !rest.includes('/');
}

/**
 * Build a Merkle tree from files and their hashes.
 * Pure function — no storage dependency.
 */
function buildMerkleTree(
  files: string[],
  fileHashMap: Map<string, string>,
  rootDir: string,
): MerkleTree {
  const resolvedRoot = path.resolve(rootDir);

  const dirToFiles = new Map<string, string[]>();
  for (const file of files) {
    const relDir = path.relative(resolvedRoot, path.dirname(file)) || '.';
    const existing = dirToFiles.get(relDir) ?? [];
    existing.push(file);
    dirToFiles.set(relDir, existing);
  }

  const sortedDirs = [...dirToFiles.keys()].sort((a, b) => dirDepth(b) - dirDepth(a));
  const dirHashes = new Map<string, string>();

  for (const dir of sortedDirs) {
    const dirFiles = dirToFiles.get(dir)!;
    const hashParts: string[] = [];

    for (const file of dirFiles.sort()) {
      const hash = fileHashMap.get(file);
      if (hash) {
        hashParts.push(`${path.basename(file)}:${hash}`);
      }
    }

    for (const [childDir, childHash] of dirHashes) {
      if (isImmediateChild(dir, childDir)) {
        hashParts.push(`${path.basename(childDir)}/:${childHash}`);
      }
    }

    hashParts.sort();
    dirHashes.set(dir, hashString(hashParts.join('\n')));
  }

  const topLevelParts: string[] = [];
  for (const [dir, hash] of dirHashes) {
    if (!dir.includes('/')) {
      topLevelParts.push(`${dir}/:${hash}`);
    }
  }
  topLevelParts.sort();
  const rootHash = hashString(topLevelParts.join('\n'));

  return { dirHashes, rootHash, dirToFiles };
}

/**
 * Hash files with bounded concurrency.
 * Uses Promise.allSettled to handle individual file failures gracefully.
 */
async function hashFiles(files: string[]): Promise<Map<string, string>> {
  const fileHashMap = new Map<string, string>();
  let failCount = 0;

  for (let i = 0; i < files.length; i += HASH_CONCURRENCY) {
    const batch = files.slice(i, i + HASH_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((f) => hashFile(f)));

    for (let j = 0; j < batch.length; j++) {
      const result = results[j];
      if (result.status === 'fulfilled') {
        fileHashMap.set(batch[j], result.value);
      } else {
        failCount++;
        log.warn(
          `Failed to hash ${batch[j]}: ${result.reason instanceof Error ? result.reason.message : result.reason}`,
        );
      }
    }
  }

  if (failCount > 0) {
    log.warn(`${failCount} files could not be hashed (will be skipped)`);
  }

  return fileHashMap;
}

// ---------------------------------------------------------------------------
// Core sync operations — accept SyncStorage parameter
// ---------------------------------------------------------------------------

/** Default storage instance used when no storage is provided. */
const defaultStorage = new SqliteSyncStorage();

/**
 * Compute which files changed since last sync using Merkle tree diff.
 * Accepts an optional SyncStorage for the backend; defaults to SqliteSyncStorage.
 */
async function computeChanges(
  files: string[],
  rootDir: string,
  storage: SyncStorage = defaultStorage,
): Promise<SyncResult> {
  const fileHashMap = await hashFiles(files);
  const tree = buildMerkleTree(files, fileHashMap, rootDir);

  const storedRoot = await storage.getDirHash(ROOT_KEY);
  if (storedRoot && storedRoot === tree.rootHash) {
    log.info('Root Merkle hash unchanged — nothing to sync');
    return { added: [], modified: [], deleted: [], fileHashMap, tree };
  }

  const added: string[] = [];
  const modified: string[] = [];

  for (const [dir, currentMerkle] of tree.dirHashes) {
    const storedDirHash = await storage.getDirHash(dir);
    if (storedDirHash && storedDirHash === currentMerkle) {
      continue;
    }

    const dirFiles = tree.dirToFiles.get(dir) ?? [];
    for (const file of dirFiles) {
      const currentHash = fileHashMap.get(file);
      if (!currentHash) continue; // file failed to hash, skip

      const storedFileHash = await storage.getFileHash(file);
      if (!storedFileHash) {
        added.push(file);
      } else if (storedFileHash !== currentHash) {
        modified.push(file);
      }
    }
  }

  const currentFileSet = new Set(files);
  const storedHashes = await storage.getAllFileHashes();
  const deleted: string[] = [];
  for (const [filePath] of storedHashes) {
    if (!currentFileSet.has(filePath)) {
      deleted.push(filePath);
    }
  }

  log.info(
    `Merkle diff: ${added.length} added, ${modified.length} modified, ${deleted.length} deleted (${files.length - added.length - modified.length} unchanged)`,
  );

  return { added, modified, deleted, fileHashMap, tree };
}

/**
 * Persist Merkle tree state after successful indexing.
 * Only rebuilds dir hashes from successful files to avoid poisoning the cache.
 * Accepts an optional SyncStorage for the backend; defaults to SqliteSyncStorage.
 */
async function persistMerkleState(
  files: string[],
  fileHashMap: Map<string, string>,
  successfulFiles: Set<string>,
  rootDir: string,
  storage: SyncStorage = defaultStorage,
): Promise<void> {
  await storage.transaction(async () => {
    for (const file of successfulFiles) {
      const hash = fileHashMap.get(file);
      if (hash) {
        await storage.setFileHash(file, hash);
      }
    }

    // Rebuild tree using only files with persisted hashes to avoid
    // caching dir hashes that include failed files
    const persistedHashMap = new Map<string, string>();
    for (const file of files) {
      const stored = await storage.getFileHash(file);
      if (stored) {
        persistedHashMap.set(file, stored);
      }
    }

    const tree = buildMerkleTree(files, persistedHashMap, rootDir);

    await storage.clearDirHashes();
    for (const [dir, hash] of tree.dirHashes) {
      await storage.setDirHash(dir, hash);
    }
    await storage.setDirHash(ROOT_KEY, tree.rootHash);
  });

  log.info('Merkle tree state persisted');
}

export { computeChanges, persistMerkleState, buildMerkleTree, hashFiles, SqliteSyncStorage };
export type { SyncStorage, SyncResult, MerkleTree };
