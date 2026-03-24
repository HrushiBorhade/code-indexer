// Chunker
export { chunkFile } from './chunker/index.js';
export type { Chunk } from './chunker/types.js';

// Walker
export { walkFiles } from './lib/walker.js';

// Hash
export { hashFile, hashString } from './lib/hash.js';

// Embedder
export { embedChunks, embedQuery, getProvider } from './lib/embedder.js';
export type { EmbeddingProvider } from './lib/embedder.js';

// Store (Qdrant)
export { ensureCollection, upsertPoints, deletePoints, searchPoints } from './lib/store.js';
export type { PointPayload, SearchResult, UpsertPoint } from './lib/store.js';

// Search
export { semanticSearch } from './lib/search.js';
export type { CodeSearchResult } from './lib/search.js';

// Grep
export { grepSearch } from './lib/grep.js';

// RRF merge
export { mergeResults } from './lib/merge.js';

// Sync (Merkle tree)
export {
  computeChanges,
  persistMerkleState,
  buildMerkleTree,
  hashFiles,
  SqliteSyncStorage,
} from './lib/sync.js';
export type { SyncStorage, SyncResult, MerkleTree } from './lib/sync.js';

// Database (SQLite)
export { initDb, closeDb } from './lib/db.js';

// Languages
export { getLanguage, getSupportedExtensions, LANGUAGE_MAP } from './lib/languages.js';

// Logger
export { createLogger } from './utils/logger.js';

// Shutdown
export { onShutdown, registerShutdownHandlers } from './lib/shutdown.js';
