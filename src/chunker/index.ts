import fs from 'node:fs/promises';
import { getLanguage } from '../languages.ts';
import type { Chunk } from './types.ts';
import { chunkAST } from './ast.ts';
import { chunkMarkdown } from './markdown.ts';
import { chunkJSON } from './json.ts';
import { chunkYAML } from './yaml.ts';
import { chunkSQL } from './sql.ts';
import { chunkGraphQL } from './graphql.ts';
import { fallbackChunk } from './fallback.ts';

async function chunkFile(filePath: string): Promise<Chunk[]> {
  const entry = getLanguage(filePath);
  if (!entry) return [];

  let source: string;
  try {
    source = await fs.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    console.error(
      `[chunker] Failed to read ${filePath}: ${(err as NodeJS.ErrnoException).code ?? err}`,
    );
    return [];
  }

  if (source.trim().length === 0) return [];

  if (entry.type === 'ast') {
    return chunkAST(source, filePath, entry.name);
  }

  switch (entry.name) {
    case 'markdown':
      return chunkMarkdown(source, filePath);
    case 'json':
      return chunkJSON(source, filePath);
    case 'yaml':
      return chunkYAML(source, filePath);
    case 'toml':
      return chunkYAML(source, filePath, 'toml');
    case 'sql':
      return chunkSQL(source, filePath);
    case 'graphql':
      return chunkGraphQL(source, filePath);
    default:
      return [fallbackChunk(source, filePath, entry.name)];
  }
}

export { chunkFile };
export type { Chunk } from './types.ts';
