import path from 'node:path';
import { walkFiles } from './walker.ts';
import { chunkFile } from './chunker/index.ts';
import { getLanguage } from './languages.ts';

const VALID_MODES = new Set(['semantic', 'grep', 'hybrid']);

async function index(targetDir: string): Promise<void> {
  const resolvedDir = path.resolve(targetDir);
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
  }
  console.timeEnd('[index] Done');
}

function search(query: string, _mode: string): void {
  console.log(`[search] TODO: search for "${query}" with mode "${_mode}" (Phase 4)`);
}

function watch(targetDir: string): void {
  const resolvedDir = path.resolve(targetDir);
  console.log(`[watch] TODO: watch ${resolvedDir} for changes (Phase 6)`);
}

function printUsage(): void {
  console.log(`Usage:
  code-indexer index [path]           Index a codebase (default: current directory)
  code-indexer search "query"         Search indexed codebase
    --mode semantic|grep|hybrid       Search mode (default: hybrid)
  code-indexer watch [path]           Watch for changes and re-index`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'index': {
      const targetDir = args[1] ?? '.';
      await index(targetDir);
      break;
    }
    case 'search': {
      const query = args[1];
      if (!query) {
        console.error('[search] Error: query is required');
        console.error('  Usage: code-indexer search "your query"');
        process.exit(1);
      }
      const modeFlag = args.indexOf('--mode');
      const modeValue = modeFlag !== -1 ? args[modeFlag + 1] : undefined;
      if (modeFlag !== -1 && !modeValue) {
        console.error('[search] Error: --mode requires a value (semantic, grep, hybrid)');
        process.exit(1);
      }
      if (modeValue && !VALID_MODES.has(modeValue)) {
        console.error(
          `[search] Error: invalid mode "${modeValue}". Must be: semantic, grep, hybrid`,
        );
        process.exit(1);
      }
      search(query, modeValue ?? 'hybrid');
      break;
    }
    case 'watch': {
      const targetDir = args[1] ?? '.';
      watch(targetDir);
      break;
    }
    default: {
      if (command) {
        console.error(`Unknown command: "${command}"\n`);
      }
      printUsage();
      process.exit(command ? 1 : 0);
    }
  }
}

main().catch((err: unknown) => {
  console.error('[fatal]', err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
