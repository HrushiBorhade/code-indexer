import './config/env.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Command, Option } from 'commander';
import { walkFiles } from './lib/walker.ts';
import { chunkFile } from './chunker/index.ts';
import type { Chunk } from './chunker/types.ts';
import { getLanguage } from './lib/languages.ts';
import { embedChunks } from './lib/embedder.ts';
import { hashString } from './lib/hash.ts';
import { initDb, closeDb, upsertChunk, deleteChunksByFile, deleteFileHash } from './lib/db.ts';
import { computeChanges, persistMerkleState } from './lib/sync.ts';
import { ensureCollection, upsertPoints, deletePoints } from './lib/store.ts';
import type { UpsertPoint } from './lib/store.ts';
import { semanticSearch } from './lib/search.ts';
import { grepSearch } from './lib/grep.ts';
import { mergeResults } from './lib/merge.ts';
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
  try {
    initDb(resolvedDir);
    await ensureCollection();
  } catch (err: unknown) {
    log.error(
      `Failed to initialize persistence layer: ${err instanceof Error ? err.message : err}. Check your QDRANT_URL and QDRANT_KEY in .env.`,
    );
    closeDb();
    process.exitCode = 1;
    return;
  }

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

  // --- Merkle tree diff: detect added, modified, deleted files ---
  const syncResult = await computeChanges(files, resolvedDir);
  const changedFiles = [...syncResult.added, ...syncResult.modified];

  // Clean up deleted files
  if (syncResult.deleted.length > 0) {
    log.info(`Removing ${syncResult.deleted.length} deleted files from index...`);
    for (const file of syncResult.deleted) {
      try {
        const oldChunks = deleteChunksByFile(file);
        if (oldChunks.length > 0) {
          await deletePoints(oldChunks.map((c) => c.qdrant_id));
        }
        deleteFileHash(file);
      } catch (err: unknown) {
        log.error(
          `Failed to clean up deleted file ${file}: ${err instanceof Error ? err.message : err}`,
        );
      }
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
  const successfulFiles = new Set<string>();
  let erroredFiles = 0;

  for (const file of changedFiles) {
    try {
      const chunks = await chunkFile(file);
      allChunks.push(...chunks);
      successfulFiles.add(file);
    } catch (err: unknown) {
      erroredFiles++;
      log.error(`Failed to chunk ${file}: ${err instanceof Error ? err.message : err}`);
    }
  }

  log.info(`Created ${allChunks.length} chunks from ${successfulFiles.size} files`);
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

  if (embeddings.length !== allChunks.length) {
    log.error(
      `Embedding count mismatch: got ${embeddings.length} embeddings for ${allChunks.length} chunks`,
    );
    process.exitCode = 1;
    return;
  }

  log.info(`Generated ${embeddings.length} embeddings (${embeddings[0].length} dimensions each)`);

  // --- Delete old chunks for successfully chunked files, then upsert new ones ---
  for (const file of successfulFiles) {
    try {
      const oldChunks = deleteChunksByFile(file);
      if (oldChunks.length > 0) {
        await deletePoints(oldChunks.map((c) => c.qdrant_id));
      }
    } catch (err: unknown) {
      log.error(
        `Failed to clean up old chunks for ${file}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  log.info('Upserting to Qdrant...');
  const chunkHashes = allChunks.map((chunk) => hashString(chunk.content));

  const points: UpsertPoint[] = allChunks.map((chunk, i) => ({
    embedding: embeddings[i],
    payload: {
      filePath: chunk.filePath,
      lineStart: chunk.lineStart,
      lineEnd: chunk.lineEnd,
      language: chunk.language,
      chunkHash: chunkHashes[i],
    },
  }));

  const qdrantIds = await upsertPoints(points);

  // --- Update SQLite cache ---
  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i];
    upsertChunk(chunkHashes[i], qdrantIds[i], chunk.filePath, chunk.lineStart, chunk.lineEnd);
  }

  // Persist Merkle tree state — only saves hashes for successful files
  persistMerkleState(syncResult.tree, syncResult.fileHashMap, successfulFiles);

  log.info(`Done in ${Date.now() - startTime}ms`);
  if (erroredFiles > 0) process.exitCode = 1;
}

async function searchAction(
  query: string,
  options: { mode: string; limit: number; path: string },
): Promise<void> {
  if (!query.trim()) {
    log.error('Search query cannot be empty.');
    process.exitCode = 1;
    return;
  }

  if (!Number.isInteger(options.limit) || options.limit < 1) {
    log.error('--limit must be a positive integer.');
    process.exitCode = 1;
    return;
  }

  const resolvedDir = path.resolve(options.path);
  const mode = options.mode;

  // Semantic and hybrid modes need Qdrant + SQLite
  if (mode === 'semantic' || mode === 'hybrid') {
    try {
      initDb(resolvedDir);
      await ensureCollection();
    } catch (err: unknown) {
      log.error(
        `Failed to initialize: ${err instanceof Error ? err.message : err}. Have you indexed this directory first?`,
      );
      closeDb();
      process.exitCode = 1;
      return;
    }
  }

  let results;
  try {
    if (mode === 'semantic') {
      results = await semanticSearch(query, options.limit);
    } else if (mode === 'grep') {
      results = await grepSearch(query, resolvedDir, options.limit);
    } else {
      // hybrid: run both in parallel, merge with RRF
      const [semanticResults, grepResults] = await Promise.all([
        semanticSearch(query, options.limit),
        grepSearch(query, resolvedDir, options.limit),
      ]);
      results = mergeResults(semanticResults, grepResults, options.limit);
    }
  } catch (err: unknown) {
    log.error(`Search failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
    return;
  }

  if (results.length === 0) {
    console.log('\nNo results found.\n');
    return;
  }

  console.log(`\n  ${results.length} results for "${query}" [${mode}]\n`);

  for (const result of results) {
    const relativePath = path.relative(resolvedDir, result.filePath);
    const scoreLabel =
      mode === 'semantic'
        ? `${(result.score * 100).toFixed(1)}%`
        : `score: ${result.score.toFixed(4)}`;

    console.log(`  ${relativePath}:${result.lineStart}-${result.lineEnd}  (${scoreLabel})`);
    console.log('  ' + '─'.repeat(60));

    const lines = result.code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineNum = String(result.lineStart + i).padStart(4);
      console.log(`  ${lineNum} │ ${lines[i]}`);
    }

    console.log('');
  }
}

function watchAction(targetDir: string): void {
  const watchLog = createLogger('watch');
  const resolvedDir = path.resolve(targetDir);
  watchLog.info(`TODO: watch ${resolvedDir} for changes (Phase 6)`);
}

// --- Register shutdown handlers + DB cleanup at module level (once per process) ---
registerShutdownHandlers();
onShutdown(closeDb);

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
  .option('-l, --limit <number>', 'max results to return', '10')
  .option('-p, --path <path>', 'target directory to search', '.')
  .action((query: string, options: { mode: string; limit: string; path: string }) => {
    return searchAction(query, {
      mode: options.mode,
      limit: parseInt(options.limit, 10),
      path: options.path,
    });
  });

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
