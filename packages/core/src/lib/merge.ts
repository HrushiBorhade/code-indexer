import type { CodeSearchResult } from './search.ts';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('merge');

const RRF_K = 60;

/**
 * Reciprocal Rank Fusion: merges two ranked result lists.
 * Score = 1/(k + rank) for each list, summed if result appears in both.
 * k=60 is the standard constant (dampens the effect of high rankings).
 */
function mergeResults(
  semanticResults: CodeSearchResult[],
  grepResults: CodeSearchResult[],
  limit: number,
): CodeSearchResult[] {
  const scoreMap = new Map<string, { score: number; result: CodeSearchResult }>();

  for (let rank = 0; rank < semanticResults.length; rank++) {
    const result = semanticResults[rank];
    const key = resultKey(result);
    const rrfScore = 1 / (RRF_K + rank + 1);
    const existing = scoreMap.get(key);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scoreMap.set(key, { score: rrfScore, result });
    }
  }

  for (let rank = 0; rank < grepResults.length; rank++) {
    const result = grepResults[rank];
    const key = resultKey(result);
    const rrfScore = 1 / (RRF_K + rank + 1);
    const existing = scoreMap.get(key);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scoreMap.set(key, { score: rrfScore, result });
    }
  }

  const merged = [...scoreMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({ ...entry.result, score: entry.score }));

  log.info(
    `Merged ${semanticResults.length} semantic + ${grepResults.length} grep → ${merged.length} results`,
  );

  return merged;
}

function resultKey(result: CodeSearchResult): string {
  return `${result.filePath}:${result.lineStart}-${result.lineEnd}`;
}

export { mergeResults, RRF_K };
