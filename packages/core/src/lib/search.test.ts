import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('../config/env.ts', () => ({
  default: {
    EMBEDDING_PROVIDER: 'openai',
    OPENAI_API_KEY: 'test-key',
    QDRANT_URL: 'https://test.qdrant.io',
    QDRANT_KEY: 'test-qdrant-key',
    NODE_ENV: 'test',
  },
}));

import { semanticSearch, readCodeSnippet } from './search.ts';

const MOCK_EMBEDDING_RESPONSE = {
  data: {
    data: [{ embedding: Array(1536).fill(0.1), index: 0 }],
    model: 'text-embedding-3-small',
    usage: { total_tokens: 5 },
  },
};

function mockFetchResponses(...responses: Array<{ data: unknown; status?: number }>) {
  const spy = vi.spyOn(globalThis, 'fetch');
  for (const r of responses) {
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify(r.data), {
        status: r.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }
  return spy;
}

describe('search', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'search-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('readCodeSnippet', () => {
    it('reads specific lines from a file', async () => {
      const filePath = path.join(tmpDir, 'sample.ts');
      await fs.writeFile(filePath, 'line1\nline2\nline3\nline4\nline5\n');

      const snippet = await readCodeSnippet(filePath, 2, 4);

      expect(snippet).toBe('line2\nline3\nline4');
    });

    it('returns null for non-existent file', async () => {
      const snippet = await readCodeSnippet('/nonexistent/file.ts', 1, 5);

      expect(snippet).toBeNull();
    });

    it('reads from line 1 correctly', async () => {
      const filePath = path.join(tmpDir, 'first.ts');
      await fs.writeFile(filePath, 'first\nsecond\nthird\n');

      const snippet = await readCodeSnippet(filePath, 1, 1);

      expect(snippet).toBe('first');
    });
  });

  describe('semanticSearch', () => {
    it('returns results with code snippets', async () => {
      const filePath = path.join(tmpDir, 'auth.ts');
      await fs.writeFile(filePath, 'function checkAuth() {\n  return true;\n}\n');

      // Mock: embedQuery response, then searchPoints response
      mockFetchResponses(MOCK_EMBEDDING_RESPONSE, {
        data: {
          result: [
            {
              id: 'uuid-1',
              score: 0.92,
              payload: {
                filePath,
                lineStart: 1,
                lineEnd: 3,
                language: 'typescript',
                chunkHash: 'hash-1',
              },
            },
          ],
        },
      });

      const results = await semanticSearch('authentication check');

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.92);
      expect(results[0].code).toBe('function checkAuth() {\n  return true;\n}');
      expect(results[0].filePath).toBe(filePath);
      expect(results[0].language).toBe('typescript');
    });

    it('skips results where file was deleted', async () => {
      mockFetchResponses(MOCK_EMBEDDING_RESPONSE, {
        data: {
          result: [
            {
              id: 'uuid-1',
              score: 0.88,
              payload: {
                filePath: '/deleted/file.ts',
                lineStart: 1,
                lineEnd: 10,
                language: 'typescript',
                chunkHash: 'hash-1',
              },
            },
          ],
        },
      });

      const results = await semanticSearch('some query');

      expect(results).toHaveLength(0);
    });

    it('returns empty array when no results found', async () => {
      mockFetchResponses(MOCK_EMBEDDING_RESPONSE, {
        data: { result: [] },
      });

      const results = await semanticSearch('nonexistent thing');

      expect(results).toHaveLength(0);
    });

    it('passes limit to searchPoints', async () => {
      const fetchSpy = mockFetchResponses(MOCK_EMBEDDING_RESPONSE, {
        data: { result: [] },
      });

      await semanticSearch('test query', 5);

      const searchBody = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);
      expect(searchBody.limit).toBe(5);
    });

    it('returns multiple results sorted by score', async () => {
      const file1 = path.join(tmpDir, 'a.ts');
      const file2 = path.join(tmpDir, 'b.ts');
      await fs.writeFile(file1, 'function a() {}');
      await fs.writeFile(file2, 'function b() {}');

      mockFetchResponses(MOCK_EMBEDDING_RESPONSE, {
        data: {
          result: [
            {
              id: 'uuid-1',
              score: 0.95,
              payload: {
                filePath: file1,
                lineStart: 1,
                lineEnd: 1,
                language: 'typescript',
                chunkHash: 'h1',
              },
            },
            {
              id: 'uuid-2',
              score: 0.82,
              payload: {
                filePath: file2,
                lineStart: 1,
                lineEnd: 1,
                language: 'typescript',
                chunkHash: 'h2',
              },
            },
          ],
        },
      });

      const results = await semanticSearch('functions');

      expect(results).toHaveLength(2);
      expect(results[0].score).toBe(0.95);
      expect(results[1].score).toBe(0.82);
    });
  });
});
