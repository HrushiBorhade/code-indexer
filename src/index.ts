import './config/env.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Command, Option } from 'commander';
import { walkFiles } from './lib/walker.ts';
import { chunkFile } from './chunker/index.ts';
import type { Chunk } from './chunker/types.ts';
import { getLanguage } from './lib/languages.ts';
import { embedChunks } from './lib/embedder.ts';
import { hashFile, hashString } from './lib/hash.ts';
import {
  initDb,
  closeDb,
  getFileHash,
  setFileHash,
  deleteFileHash,
  getAllFileHashes,
  upsertChunk,
  deleteChunksByFile,
} from './lib/db.ts';
import { ensureCollection, upsertPoints, deletePoints } from './lib/store.ts';
import type { UpsertPoint } from './lib/store.ts';
import { registerShutdownHandlers, onShutdown } from './lib/shutdown.ts';
import { createLogger } from './utils/logger.ts';

const log = createLogger('index');

async function indexAction(targetDir: string): Promise<void> {
  const resolvedDir = path.resolve(targetDir);

  try {
    const stat = await fs.stat(resolvedDir);
    if (!stat.isDirectory()) {
      log.error(`"${resolvedDir}" is not a directory.`);
      process.exitCode = 1;
      return;
    }
  } catch (err: unknown) {
    log.error(`Cannot access "${resolvedDir}": ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
    return;
  }

  log.info(`Scanning ${resolvedDir}...`);
  const startTime = Date.now();

  // --- Init persistence layer ---
  initDb(resolvedDir);
  onShutdown(closeDb);
  await ensureCollection();

  // --- Walk files ---
  const files = await walkFiles(resolvedDir);
  if (files.length === 0) {
    log.info('No supported files found.');
    return;
  }

  const langCounts = new Map<string, number>();
  for (const file of files) {
    const entry = getLanguage(file);
    if (entry) {
      langCounts.set(entry.name, (langCounts.get(entry.name) ?? 0) + 1);
    }
  }

  const breakdown = [...langCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lang, count]) => `${count} ${lang}`)
    .join(', ');

  log.info(`Found ${files.length} files (${breakdown})`);

  // --- Hash check: skip unchanged files ---
  const changedFiles: string[] = [];
  for (const file of files) {
    const currentHash = await hashFile(file);
    const cached = getFileHash(file);
    if (cached && cached.sha256 === currentHash) continue;
    changedFiles.push(file);
  }

  // --- Detect deleted files ---
  const currentFileSet = new Set(files);
  const storedHashes = getAllFileHashes();
  const deletedFiles = storedHashes.filter((row) => !currentFileSet.has(row.file_path));

  if (deletedFiles.length > 0) {
    log.info(`Removing ${deletedFiles.length} deleted files from index...`);
    for (const row of deletedFiles) {
      const oldChunks = deleteChunksByFile(row.file_path);
      if (oldChunks.length > 0) {
        await deletePoints(oldChunks.map((c) => c.qdrant_id));
      }
      deleteFileHash(row.file_path);
    }
  }

  if (changedFiles.length === 0) {
    log.info(`All ${files.length} files unchanged. Nothing to index.`);
    log.info(`Done in ${Date.now() - startTime}ms`);
    return;
  }

  log.info(
    `${changedFiles.length} changed files to index (${files.length - changedFiles.length} unchanged, skipped)`,
  );

  // --- Chunk changed files ---
  log.info('Chunking files...');
  const allChunks: Chunk[] = [];
  let erroredFiles = 0;

  for (const file of changedFiles) {
    // Remove old chunks for this file before re-chunking
    const oldChunks = deleteChunksByFile(file);
    if (oldChunks.length > 0) {
      await deletePoints(oldChunks.map((c) => c.qdrant_id));
    }

    try {
      const chunks = await chunkFile(file);
      allChunks.push(...chunks);
    } catch (err: unknown) {
      erroredFiles++;
      log.error(`Failed to chunk ${file}: ${err instanceof Error ? err.message : err}`);
    }
  }

  log.info(`Created ${allChunks.length} chunks from ${changedFiles.length - erroredFiles} files`);
  if (erroredFiles > 0) {
    log.warn(`${erroredFiles} files failed to chunk (see errors above)`);
  }

  if (allChunks.length === 0) {
    log.warn('No chunks to embed.');
    if (erroredFiles > 0) process.exitCode = 1;
    return;
  }

  // --- Embed ---
  log.info('Embedding chunks...');
  let embeddings: number[][];
  try {
    embeddings = await embedChunks(allChunks);
  } catch (err: unknown) {
    log.error(`Embedding failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
    return;
  }

  if (embeddings.length === 0) {
    log.error('Embedding returned no results.');
    process.exitCode = 1;
    return;
  }

  if (embeddings.length !== allChunks.length) {
    log.error(
      `Embedding count mismatch: got ${embeddings.length} embeddings for ${allChunks.length} chunks`,
    );
    process.exitCode = 1;
    return;
  }

  log.info(`Generated ${embeddings.length} embeddings (${embeddings[0].length} dimensions each)`);

  // --- Upsert to Qdrant ---
  log.info('Upserting to Qdrant...');
  const points: UpsertPoint[] = allChunks.map((chunk, i) => ({
    embedding: embeddings[i],
    payload: {
      filePath: chunk.filePath,
      lineStart: chunk.lineStart,
      lineEnd: chunk.lineEnd,
      language: chunk.language,
      chunkHash: hashString(chunk.content),
    },
  }));

  const qdrantIds = await upsertPoints(points);

  // --- Update SQLite cache ---
  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i];
    upsertChunk(
      hashString(chunk.content),
      qdrantIds[i],
      chunk.filePath,
      chunk.lineStart,
      chunk.lineEnd,
    );
  }

  // Update file hashes for all changed files (including ones that errored — they'll re-process next run)
  for (const file of changedFiles) {
    const currentHash = await hashFile(file);
    setFileHash(file, currentHash);
  }

  log.info(`Done in ${Date.now() - startTime}ms`);
  if (erroredFiles > 0) process.exitCode = 1;
}

function searchAction(query: string, options: { mode: string }): void {
  const searchLog = createLogger('search');
  searchLog.info(`TODO: search for "${query}" with mode "${options.mode}" (Phase 4)`);
}

function watchAction(targetDir: string): void {
  const watchLog = createLogger('watch');
  const resolvedDir = path.resolve(targetDir);
  watchLog.info(`TODO: watch ${resolvedDir} for changes (Phase 6)`);
}

// --- Register shutdown handlers before CLI parsing ---
registerShutdownHandlers();

const program = new Command();

program
  .name('code-indexer')
  .description('Cursor-inspired semantic code search engine')
  .version('0.1.0');

program
  .command('index')
  .description('Index a codebase for semantic search')
  .argument('[path]', 'target directory to index', '.')
  .action(indexAction);

program
  .command('search')
  .description('Search indexed codebase')
  .argument('<query>', 'search query')
  .addOption(
    new Option('-m, --mode <mode>', 'search mode')
      .choices(['semantic', 'grep', 'hybrid'])
      .default('hybrid'),
  )
  .action(searchAction);

program
  .command('watch')
  .description('Watch for changes and re-index')
  .argument('[path]', 'target directory to watch', '.')
  .action(watchAction);

program.parseAsync().catch((err: unknown) => {
  const fatalLog = createLogger('fatal');
  fatalLog.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
