import fs from 'node:fs/promises';
import { embedQuery } from './embedder.ts';
import { searchPoints } from './store.ts';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('search');

const DEFAULT_LIMIT = 10;

interface CodeSearchResult {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  language: string;
  score: number;
  code: string;
}

async function readCodeSnippet(
  filePath: string,
  lineStart: number,
  lineEnd: number,
): Promise<string | null> {
  if (lineStart < 1 || lineEnd < lineStart) {
    log.warn(`Invalid line range [${lineStart}-${lineEnd}] for ${filePath}`);
    return null;
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    return lines.slice(lineStart - 1, lineEnd).join('\n');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      log.warn(`Failed to read ${filePath}: ${err instanceof Error ? err.message : err}`);
    }
    return null;
  }
}

async function semanticSearch(
  query: string,
  limit: number = DEFAULT_LIMIT,
): Promise<CodeSearchResult[]> {
  log.info(`Searching for: "${query}" (limit: ${limit})`);

  const queryVector = await embedQuery(query);
  const qdrantResults = await searchPoints(queryVector, limit);

  if (qdrantResults.length === 0) {
    log.info('No results found');
    return [];
  }

  // Read all code snippets in parallel
  const snippets = await Promise.all(
    qdrantResults.map((r) =>
      readCodeSnippet(r.payload.filePath, r.payload.lineStart, r.payload.lineEnd),
    ),
  );

  const results: CodeSearchResult[] = [];

  for (let i = 0; i < qdrantResults.length; i++) {
    const result = qdrantResults[i];
    const code = snippets[i];

    if (code === null) {
      log.warn(`Skipping result — could not read ${result.payload.filePath}`);
      continue;
    }

    results.push({
      filePath: result.payload.filePath,
      lineStart: result.payload.lineStart,
      lineEnd: result.payload.lineEnd,
      language: result.payload.language,
      score: result.score,
      code,
    });
  }

  log.info(`Found ${results.length} results`);
  return results;
}

export { semanticSearch, readCodeSnippet, DEFAULT_LIMIT };
export type { CodeSearchResult };
