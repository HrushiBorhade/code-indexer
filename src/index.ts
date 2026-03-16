import fs from 'node:fs/promises';
import path from 'node:path';
import { Command, Option } from 'commander';
import { walkFiles } from './walker.ts';
import { chunkFile } from './chunker/index.ts';
import { getLanguage } from './languages.ts';

async function indexAction(targetDir: string): Promise<void> {
  const resolvedDir = path.resolve(targetDir);

  try {
    const stat = await fs.stat(resolvedDir);
    if (!stat.isDirectory()) {
      console.error(`[index] "${resolvedDir}" is not a directory.`);
      process.exitCode = 1;
      return;
    }
  } catch {
    console.error(
      `[index] Cannot access "${resolvedDir}". Check that the path exists and you have read permissions.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`[index] Scanning ${resolvedDir}...`);
  console.time('[index] Done');

  const files = await walkFiles(resolvedDir);
  if (files.length === 0) {
    console.log('[index] No supported files found.');
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

  console.log(`[index] Found ${files.length} files (${breakdown})`);
  console.log('[index] Chunking files...');

  let totalChunks = 0;
  let erroredFiles = 0;

  for (const file of files) {
    try {
      const chunks = await chunkFile(file);
      totalChunks += chunks.length;
    } catch (err: unknown) {
      erroredFiles++;
      console.error(`[index] Failed to chunk ${file}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`[index] Created ${totalChunks} chunks from ${files.length} files`);
  if (erroredFiles > 0) {
    console.warn(`[index] ${erroredFiles} files failed to chunk (see errors above)`);
    process.exitCode = 1;
  }
  console.timeEnd('[index] Done');
}

function searchAction(query: string, options: { mode: string }): void {
  console.log(`[search] TODO: search for "${query}" with mode "${options.mode}" (Phase 4)`);
}

function watchAction(targetDir: string): void {
  const resolvedDir = path.resolve(targetDir);
  console.log(`[watch] TODO: watch ${resolvedDir} for changes (Phase 6)`);
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
  console.error('[fatal]', err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
