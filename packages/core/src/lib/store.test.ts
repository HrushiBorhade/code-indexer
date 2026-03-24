import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../config/env.ts', () => ({
  default: {
    EMBEDDING_PROVIDER: 'openai',
    OPENAI_API_KEY: 'test-key',
    QDRANT_URL: 'https://test.qdrant.io',
    QDRANT_KEY: 'test-qdrant-key',
    NODE_ENV: 'test',
  },
}));

import {
  ensureCollection,
  upsertPoints,
  deletePoints,
  searchPoints,
  COLLECTION_NAME,
} from './store.ts';
import type { UpsertPoint } from './store.ts';

function mockJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makePoint(index: number): UpsertPoint {
  return {
    embedding: Array.from({ length: 1536 }, (_, d) => index * 0.001 + d * 0.0001),
    payload: {
      filePath: `/src/file-${index}.ts`,
      lineStart: 1,
      lineEnd: 25,
      language: 'typescript',
      chunkHash: `hash-${index}`,
    },
  };
}

function getRequestBody(callIndex = 0) {
  return JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[callIndex][1].body);
}

function getRequestUrl(callIndex = 0): string {
  return (fetch as ReturnType<typeof vi.fn>).mock.calls[callIndex][0];
}

describe('store', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ensureCollection', () => {
    it('skips creation if collection already exists', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ result: { status: 'green' } }, 200),
      );

      await ensureCollection();

      expect(fetch).toHaveBeenCalledOnce();
      expect(getRequestUrl(0)).toContain(`/collections/${COLLECTION_NAME}`);
    });

    it('creates collection if it does not exist', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockResolvedValueOnce(mockJsonResponse({ status: { error: 'not found' } }, 404))
        .mockResolvedValueOnce(mockJsonResponse({ result: true }, 200))
        .mockResolvedValueOnce(mockJsonResponse({ result: true }, 200)); // payload index

      await ensureCollection();

      expect(fetchSpy).toHaveBeenCalledTimes(3);

      const createBody = getRequestBody(1);
      expect(createBody.vectors.size).toBe(1536);
      expect(createBody.vectors.distance).toBe('Cosine');

      const indexBody = getRequestBody(2);
      expect(indexBody.field_name).toBe('repo_id');
      expect(indexBody.field_schema).toBe('keyword');
    });

    it('throws on non-200/non-404 status from GET check', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ status: { error: 'unauthorized' } }, 401),
      );

      await expect(ensureCollection()).rejects.toThrow('collection check failed with status 401');
    });

    it('throws on collection creation failure', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockResolvedValueOnce(mockJsonResponse({}, 404))
        .mockResolvedValueOnce(mockJsonResponse({ status: { error: 'bad request' } }, 400));

      await expect(ensureCollection()).rejects.toThrow('Failed to create Qdrant collection');
    });
  });

  describe('upsertPoints', () => {
    it('returns empty array for empty input', async () => {
      const ids = await upsertPoints([]);
      expect(ids).toEqual([]);
    });

    it('upserts points and returns UUIDs', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ result: { status: 'completed' } }),
      );

      const points = [makePoint(0), makePoint(1), makePoint(2)];
      const ids = await upsertPoints(points);

      expect(ids).toHaveLength(3);
      ids.forEach((id) => {
        expect(id).toMatch(/^[a-f0-9-]{36}$/);
      });

      const body = getRequestBody(0);
      expect(body.points).toHaveLength(3);
      expect(body.points[0].vector).toHaveLength(1536);
      expect(body.points[0].payload.filePath).toBe('/src/file-0.ts');
    });

    it('sends correct auth headers', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ result: { status: 'completed' } }),
      );

      await upsertPoints([makePoint(0)]);

      const headers = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
      expect(headers['api-key']).toBe('test-qdrant-key');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('batches large upserts into chunks of 100', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockImplementation(async () =>
        mockJsonResponse({ result: { status: 'completed' } }),
      );

      const points = Array.from({ length: 250 }, (_, i) => makePoint(i));
      const ids = await upsertPoints(points);

      expect(ids).toHaveLength(250);
      // 250 points = 3 batches (100 + 100 + 50)
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      expect(getRequestBody(0).points).toHaveLength(100);
      expect(getRequestBody(1).points).toHaveLength(100);
      expect(getRequestBody(2).points).toHaveLength(50);
    });

    it('throws on non-retryable upsert failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ status: { error: 'bad request' } }, 400),
      );

      await expect(upsertPoints([makePoint(0)])).rejects.toThrow('Failed to upsert points');
    });
  });

  describe('deletePoints', () => {
    it('is a no-op for empty ids array', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      await deletePoints([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sends delete request with point ids', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ result: { status: 'completed' } }),
      );

      await deletePoints(['id-1', 'id-2', 'id-3']);

      const body = getRequestBody(0);
      expect(body.points).toEqual(['id-1', 'id-2', 'id-3']);
      expect(getRequestUrl(0)).toContain('/points/delete');
    });

    it('throws on delete failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ status: { error: 'not found' } }, 404),
      );

      await expect(deletePoints(['bad-id'])).rejects.toThrow('Failed to delete points');
    });
  });

  describe('searchPoints', () => {
    it('returns search results with scores and payloads', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({
          result: [
            {
              id: 'uuid-1',
              score: 0.95,
              payload: {
                filePath: '/src/auth.ts',
                lineStart: 10,
                lineEnd: 30,
                language: 'typescript',
                chunkHash: 'hash-1',
              },
            },
            {
              id: 'uuid-2',
              score: 0.87,
              payload: {
                filePath: '/src/login.ts',
                lineStart: 1,
                lineEnd: 15,
                language: 'typescript',
                chunkHash: 'hash-2',
              },
            },
          ],
        }),
      );

      const queryVector = Array.from({ length: 1536 }, () => 0.1);
      const results = await searchPoints(queryVector, 5);

      expect(results).toHaveLength(2);
      expect(results[0].score).toBe(0.95);
      expect(results[0].payload.filePath).toBe('/src/auth.ts');
      expect(results[1].score).toBe(0.87);

      const body = getRequestBody(0);
      expect(body.vector).toHaveLength(1536);
      expect(body.limit).toBe(5);
      expect(body.with_payload).toBe(true);
    });

    it('throws on search failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ status: { error: 'collection not found' } }, 404),
      );

      await expect(searchPoints([], 10)).rejects.toThrow('Qdrant search failed');
    });
  });
});
