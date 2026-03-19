import { describe, it, expect } from 'vitest';
import { mergeResults, RRF_K } from './merge.ts';
import type { CodeSearchResult } from './search.ts';

function makeResult(filePath: string, lineStart: number, lineEnd: number): CodeSearchResult {
  return {
    filePath,
    lineStart,
    lineEnd,
    language: 'typescript',
    score: 0,
    code: `// code at ${filePath}:${lineStart}`,
  };
}

describe('merge (RRF)', () => {
  it('merges two result lists sorted by combined RRF score', () => {
    const semantic = [makeResult('/a.ts', 1, 10), makeResult('/b.ts', 1, 10)];
    const grep = [makeResult('/c.ts', 1, 10), makeResult('/a.ts', 1, 10)];

    const merged = mergeResults(semantic, grep, 10);

    // /a.ts appears in both lists → highest combined score
    expect(merged[0].filePath).toBe('/a.ts');
    expect(merged.length).toBe(3);
  });

  it('deduplicates results with same file and line range', () => {
    const semantic = [makeResult('/same.ts', 1, 10)];
    const grep = [makeResult('/same.ts', 1, 10)];

    const merged = mergeResults(semantic, grep, 10);

    expect(merged).toHaveLength(1);
    expect(merged[0].filePath).toBe('/same.ts');
  });

  it('combined score is higher than individual scores', () => {
    const semantic = [makeResult('/both.ts', 1, 10)];
    const grep = [makeResult('/both.ts', 1, 10)];

    const merged = mergeResults(semantic, grep, 10);

    // Score should be 2 * 1/(k+1) since it appears at rank 0 in both lists
    const expectedScore = 2 * (1 / (RRF_K + 1));
    expect(merged[0].score).toBeCloseTo(expectedScore, 10);
  });

  it('respects limit parameter', () => {
    const semantic = Array.from({ length: 20 }, (_, i) => makeResult(`/s${i}.ts`, 1, 10));
    const grep = Array.from({ length: 20 }, (_, i) => makeResult(`/g${i}.ts`, 1, 10));

    const merged = mergeResults(semantic, grep, 5);

    expect(merged).toHaveLength(5);
  });

  it('handles empty semantic results', () => {
    const grep = [makeResult('/a.ts', 1, 10), makeResult('/b.ts', 1, 10)];

    const merged = mergeResults([], grep, 10);

    expect(merged).toHaveLength(2);
  });

  it('handles empty grep results', () => {
    const semantic = [makeResult('/a.ts', 1, 10)];

    const merged = mergeResults(semantic, [], 10);

    expect(merged).toHaveLength(1);
  });

  it('handles both empty', () => {
    const merged = mergeResults([], [], 10);

    expect(merged).toHaveLength(0);
  });

  it('higher-ranked results get higher RRF scores', () => {
    const semantic = [makeResult('/first.ts', 1, 10), makeResult('/second.ts', 1, 10)];

    const merged = mergeResults(semantic, [], 10);

    expect(merged[0].filePath).toBe('/first.ts');
    expect(merged[1].filePath).toBe('/second.ts');
    expect(merged[0].score).toBeGreaterThan(merged[1].score);
  });

  it('distinguishes results with different line ranges in same file', () => {
    const semantic = [makeResult('/file.ts', 1, 10)];
    const grep = [makeResult('/file.ts', 20, 30)];

    const merged = mergeResults(semantic, grep, 10);

    // Different line ranges = different results (not deduplicated)
    expect(merged).toHaveLength(2);
  });
});
