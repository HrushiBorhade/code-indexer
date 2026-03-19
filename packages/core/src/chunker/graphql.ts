import { splitByBoundary } from './split-by-boundary.ts';
import type { Chunk } from './types.ts';

const GQL_DEFINITION =
  /^(type|input|enum|interface|union|scalar|query|mutation|subscription|fragment|extend|schema)\b/;

function chunkGraphQL(source: string, filePath: string): Chunk[] {
  return splitByBoundary(source, filePath, 'graphql', (line) => GQL_DEFINITION.test(line));
}

export { chunkGraphQL };
