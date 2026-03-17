import path from 'node:path';
import { hashFile, hashString } from './hash.ts';
import {
  getFileHash,
  setFileHash,
  getAllFileHashes,
  getDirHash,
  setDirHash,
  clearDirHashes,
} from './db.ts';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('sync');

const ROOT_KEY = '__root__';
const HASH_CONCURRENCY = 32;

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

/**
 * Compute which files changed since last sync using Merkle tree diff.
 */
async function computeChanges(files: string[], rootDir: string): Promise<SyncResult> {
  const fileHashMap = await hashFiles(files);
  const tree = buildMerkleTree(files, fileHashMap, rootDir);

  const storedRoot = getDirHash(ROOT_KEY);
  if (storedRoot && storedRoot.merkle_hash === tree.rootHash) {
    log.info('Root Merkle hash unchanged — nothing to sync');
    return { added: [], modified: [], deleted: [], fileHashMap, tree };
  }

  const added: string[] = [];
  const modified: string[] = [];

  for (const [dir, currentMerkle] of tree.dirHashes) {
    const storedDirHash = getDirHash(dir);
    if (storedDirHash && storedDirHash.merkle_hash === currentMerkle) {
      continue;
    }

    const dirFiles = tree.dirToFiles.get(dir) ?? [];
    for (const file of dirFiles) {
      const currentHash = fileHashMap.get(file);
      if (!currentHash) continue; // file failed to hash, skip

      const storedFileHash = getFileHash(file);
      if (!storedFileHash) {
        added.push(file);
      } else if (storedFileHash.sha256 !== currentHash) {
        modified.push(file);
      }
    }
  }

  const currentFileSet = new Set(files);
  const storedHashes = getAllFileHashes();
  const deleted = storedHashes
    .filter((row) => !currentFileSet.has(row.file_path))
    .map((row) => row.file_path);

  log.info(
    `Merkle diff: ${added.length} added, ${modified.length} modified, ${deleted.length} deleted (${files.length - added.length - modified.length} unchanged)`,
  );

  return { added, modified, deleted, fileHashMap, tree };
}

/**
 * Persist Merkle tree state to SQLite after successful indexing.
 * Only rebuilds dir hashes from successful files to avoid poisoning the cache.
 */
function persistMerkleState(
  files: string[],
  fileHashMap: Map<string, string>,
  successfulFiles: Set<string>,
  rootDir: string,
): void {
  for (const file of successfulFiles) {
    const hash = fileHashMap.get(file);
    if (hash) {
      setFileHash(file, hash);
    }
  }

  // Rebuild tree using only files with persisted hashes to avoid
  // caching dir hashes that include failed files
  const persistedHashMap = new Map<string, string>();
  for (const file of files) {
    const stored = getFileHash(file);
    if (stored) {
      persistedHashMap.set(file, stored.sha256);
    }
  }

  const tree = buildMerkleTree(files, persistedHashMap, rootDir);

  clearDirHashes();
  for (const [dir, hash] of tree.dirHashes) {
    setDirHash(dir, hash);
  }
  setDirHash(ROOT_KEY, tree.rootHash);

  log.info('Merkle tree state persisted to SQLite');
}

export { computeChanges, persistMerkleState };
export type { SyncResult, MerkleTree };
