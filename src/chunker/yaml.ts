import { splitByBoundary } from './split-by-boundary.ts';
import { fallbackChunk } from './fallback.ts';
import type { Chunk } from './types.ts';

const SMALL_FILE_THRESHOLD = 50;
const TOP_LEVEL_KEY = /^[a-zA-Z_][\w-]*:/;

function chunkYAML(source: string, filePath: string, language: string = 'yaml'): Chunk[] {
  const lines = source.split('\n');
  if (lines.length <= SMALL_FILE_THRESHOLD) {
    return [fallbackChunk(source, filePath, language)];
  }

  return splitByBoundary(source, filePath, language, (line) => TOP_LEVEL_KEY.test(line));
}

export { chunkYAML };
