import type { Chunk } from './types.ts';
import { fallbackChunk } from './fallback.ts';

function splitByBoundary(
  source: string,
  filePath: string,
  language: string,
  isBoundary: (line: string) => boolean,
): Chunk[] {
  const lines = source.split('\n');
  const chunks: Chunk[] = [];
  let currentLines: string[] = [];
  let chunkStart = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isBoundary(line) && currentLines.length > 0) {
      const content = currentLines.join('\n').trim();
      if (content.length > 0) {
        chunks.push({
          content,
          filePath,
          lineStart: chunkStart,
          lineEnd: i,
          language,
          type: 'text',
        });
      }
      currentLines = [line];
      chunkStart = i + 1;
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    const content = currentLines.join('\n').trim();
    if (content.length > 0) {
      chunks.push({
        content,
        filePath,
        lineStart: chunkStart,
        lineEnd: lines.length,
        language,
        type: 'text',
      });
    }
  }

  return chunks.length > 0 ? chunks : [fallbackChunk(source, filePath, language)];
}

export { splitByBoundary };
