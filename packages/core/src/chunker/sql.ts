import type { Chunk } from './types.ts';
import { fallbackChunk } from './fallback.ts';

// Known limitation: splits on all semicolons, including those inside string
// literals or comments. A proper fix requires a SQL tokenizer, which is
// overkill for Phase 1. In practice, DDL/schema files (the main use case)
// rarely have semicolons inside strings.
function chunkSQL(source: string, filePath: string): Chunk[] {
  const statements = source.split(';').filter((s) => s.trim().length > 0);

  if (statements.length <= 1) {
    return [fallbackChunk(source, filePath, 'sql')];
  }

  const chunks: Chunk[] = [];
  let lineOffset = 1;

  for (const statement of statements) {
    const content = statement.trim();
    if (content.length === 0) continue;

    const lineCount = statement.split('\n').length;
    chunks.push({
      content: content + ';',
      filePath,
      lineStart: lineOffset,
      lineEnd: lineOffset + lineCount - 1,
      language: 'sql',
      type: 'text',
    });
    lineOffset += lineCount;
  }

  return chunks;
}

export { chunkSQL };
