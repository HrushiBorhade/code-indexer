import type { Chunk } from './types.ts';
import { fallbackChunk } from './fallback.ts';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('chunker');

const SMALL_FILE_THRESHOLD = 50;

function chunkJSON(source: string, filePath: string): Chunk[] {
  const lines = source.split('\n');
  if (lines.length <= SMALL_FILE_THRESHOLD) {
    return [fallbackChunk(source, filePath, 'json')];
  }

  try {
    const parsed = JSON.parse(source);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return [fallbackChunk(source, filePath, 'json')];
    }

    const chunks: Chunk[] = [];
    for (const key of Object.keys(parsed)) {
      const value = JSON.stringify({ [key]: parsed[key] }, null, 2);
      // Known limitation: JSON line positions can't be determined without a
      // streaming parser, so chunks point to the whole file. Acceptable for
      // Phase 1 — the content itself is still correctly split by key.
      chunks.push({
        content: value,
        filePath,
        lineStart: 1,
        lineEnd: lines.length,
        language: 'json',
        type: 'text',
      });
    }

    return chunks.length > 0 ? chunks : [fallbackChunk(source, filePath, 'json')];
  } catch (err: unknown) {
    log.warn(`JSON parse failed for ${filePath}: ${err instanceof Error ? err.message : err}`);
    return [fallbackChunk(source, filePath, 'json')];
  }
}

export { chunkJSON };
