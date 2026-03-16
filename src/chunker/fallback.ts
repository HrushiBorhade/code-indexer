import type { Chunk } from './types.ts';

function fallbackChunk(source: string, filePath: string, language: string): Chunk {
  const lines = source.split('\n');
  return {
    content: source.trim(),
    filePath,
    lineStart: 1,
    lineEnd: lines.length,
    language,
    type: 'text',
  };
}

export { fallbackChunk };
