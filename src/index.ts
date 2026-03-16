import dotenv from 'dotenv';
const dotenvResult = dotenv.config();
if (dotenvResult.error) {
  console.warn(`[env] Warning: Failed to load .env file: ${dotenvResult.error.message}`);
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { Command, Option } from 'commander';
import './env.ts';
import { walkFiles } from './walker.ts';
import { chunkFile } from './chunker/index.ts';
import { getLanguage } from './languages.ts';
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
  } catch {
    log.error(
      `Cannot access "${resolvedDir}". Check that the path exists and you have read permissions.`,
    );
    process.exitCode = 1;
    return;
  }

  log.info(`Scanning ${resolvedDir}...`);
  const startTime = Date.now();

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
  log.info('Chunking files...');

  let totalChunks = 0;
  let erroredFiles = 0;

  for (const file of files) {
    try {
      const chunks = await chunkFile(file);
      totalChunks += chunks.length;
    } catch (err: unknown) {
      erroredFiles++;
      log.error(`Failed to chunk ${file}: ${err instanceof Error ? err.message : err}`);
    }
  }

  log.info(`Created ${totalChunks} chunks from ${files.length} files`);
  if (erroredFiles > 0) {
    log.warn(`${erroredFiles} files failed to chunk (see errors above)`);
    process.exitCode = 1;
  }
  log.info(`Done in ${Date.now() - startTime}ms`);
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
