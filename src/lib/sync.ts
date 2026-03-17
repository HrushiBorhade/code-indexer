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

  // Sort by depth descending (children before parents)
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

  // Root hash: combine all top-level entries
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
 * Hash files with bounded concurrency, reusing stored hashes for unchanged files.
 */
async function hashFilesWithCache(files: string[]): Promise<Map<string, string>> {
  const fileHashMap = new Map<string, string>();

  // Use stored hashes where possible, mark files needing fresh hash
  const needsHash: string[] = [];
  for (const file of files) {
    const stored = getFileHash(file);
    if (stored) {
      // Optimistic: assume stored hash is still valid, will be corrected by Merkle diff
      fileHashMap.set(file, stored.sha256);
    }
    // Always need fresh hash for Merkle correctness — but use concurrency
    needsHash.push(file);
  }

  // Hash files with bounded concurrency
  for (let i = 0; i < needsHash.length; i += HASH_CONCURRENCY) {
    const batch = needsHash.slice(i, i + HASH_CONCURRENCY);
    const hashes = await Promise.all(batch.map((f) => hashFile(f)));
    for (let j = 0; j < batch.length; j++) {
      fileHashMap.set(batch[j], hashes[j]);
    }
  }

  return fileHashMap;
}

/**
 * Compute which files changed since last sync using Merkle tree diff.
 */
async function computeChanges(files: string[], rootDir: string): Promise<SyncResult> {
  const fileHashMap = await hashFilesWithCache(files);
  const tree = buildMerkleTree(files, fileHashMap, rootDir);

  // Quick check: if root hash matches, nothing changed
  const storedRoot = getDirHash(ROOT_KEY);
  if (storedRoot && storedRoot.merkle_hash === tree.rootHash) {
    log.info('Root Merkle hash unchanged — nothing to sync');
    return { added: [], modified: [], deleted: [], fileHashMap, tree };
  }

  // Walk changed directories, compare individual files
  const added: string[] = [];
  const modified: string[] = [];

  for (const [dir, currentMerkle] of tree.dirHashes) {
    const storedDirHash = getDirHash(dir);
    if (storedDirHash && storedDirHash.merkle_hash === currentMerkle) {
      continue;
    }

    const dirFiles = tree.dirToFiles.get(dir) ?? [];
    for (const file of dirFiles) {
      const currentHash = fileHashMap.get(file)!;
      const storedFileHash = getFileHash(file);

      if (!storedFileHash) {
        added.push(file);
      } else if (storedFileHash.sha256 !== currentHash) {
        modified.push(file);
      }
    }
  }

  // Detect deleted files
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
 * Reuses the tree from computeChanges (no rebuild).
 */
function persistMerkleState(
  tree: MerkleTree,
  fileHashMap: Map<string, string>,
  successfulFiles: Set<string>,
): void {
  for (const file of successfulFiles) {
    const hash = fileHashMap.get(file);
    if (hash) {
      setFileHash(file, hash);
    }
  }

  clearDirHashes();
  for (const [dir, hash] of tree.dirHashes) {
    setDirHash(dir, hash);
  }
  setDirHash(ROOT_KEY, tree.rootHash);

  log.info('Merkle tree state persisted to SQLite');
}

export { computeChanges, persistMerkleState };
export type { SyncResult, MerkleTree };
