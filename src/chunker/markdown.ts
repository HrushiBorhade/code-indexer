import { splitByBoundary } from './split-by-boundary.ts';
import type { Chunk } from './types.ts';

function chunkMarkdown(source: string, filePath: string): Chunk[] {
  return splitByBoundary(source, filePath, 'markdown', (line) => line.startsWith('## '));
}

export { chunkMarkdown };
