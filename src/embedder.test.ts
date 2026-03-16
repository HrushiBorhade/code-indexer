import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./env.ts', () => ({
  default: { VOYAGE_API_KEY: 'test-key', NODE_ENV: 'test' },
}));

import { embedBatch, embedChunks, embedQuery, BATCH_SIZE, MAX_CONCURRENCY } from './embedder.ts';
import type { Chunk } from './chunker/types.ts';

function makeChunk(content: string): Chunk {
  return {
    content,
    filePath: '/fake/file.ts',
    lineStart: 1,
    lineEnd: 10,
    language: 'typescript',
    type: 'ast',
  };
}

function makeVoyageResponse(count: number) {
  return {
    data: Array.from({ length: count }, (_, i) => ({
      embedding: Array.from({ length: 1024 }, (__, d) => i * 0.001 + d * 0.0001),
      index: i,
    })),
    model: 'voyage-code-3',
    usage: { total_tokens: count * 50 },
  };
}

function mockOkResponse(count: number): Response {
  return new Response(JSON.stringify(makeVoyageResponse(count)), { status: 200 });
}

function getRequestBody(callIndex = 0) {
  return JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[callIndex][1].body);
}

describe('embedder', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('embedBatch', () => {
    it('returns embeddings for a batch of texts', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockOkResponse(3));

      const result = await embedBatch(['code1', 'code2', 'code3']);

      expect(result).toHaveLength(3);
      expect(result[0]).toHaveLength(1024);
      expect(fetch).toHaveBeenCalledOnce();
    });

    it('returns empty array for empty input', async () => {
      const result = await embedBatch([]);
      expect(result).toEqual([]);
    });

    it('sends correct request body with input_type document', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockOkResponse(1));

      await embedBatch(['function hello() {}'], 'document');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.voyageai.com/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-key',
          },
          body: JSON.stringify({
            input: ['function hello() {}'],
            model: 'voyage-code-3',
            input_type: 'document',
          }),
        }),
      );
    });

    it('sends input_type query when specified', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockOkResponse(1));

      await embedBatch(['where is auth handled'], 'query');

      expect(getRequestBody().input_type).toBe('query');
    });

    it('retries on 429 then succeeds', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
        .mockResolvedValueOnce(mockOkResponse(1));

      const result = await embedBatch(['code']);

      expect(result).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    }, 10_000);

    it('throws after max retries on persistent 429', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('rate limited', { status: 429 }),
      );

      await expect(embedBatch(['code'])).rejects.toThrow('Voyage API error 429 after');
    }, 30_000);

    it('retries on 5xx errors then succeeds', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockResolvedValueOnce(new Response('server error', { status: 503 }))
        .mockResolvedValueOnce(mockOkResponse(1));

      const result = await embedBatch(['code']);

      expect(result).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    }, 10_000);

    it('throws immediately on non-retryable errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('bad request', { status: 400 }),
      );

      await expect(embedBatch(['code'])).rejects.toThrow('Voyage API error 400');
    });

    it('retries on network errors then succeeds', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(mockOkResponse(1));

      const result = await embedBatch(['code']);

      expect(result).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    }, 10_000);

    it('throws after max retries on persistent network errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

      await expect(embedBatch(['code'])).rejects.toThrow('network error after');
    }, 30_000);

    it('throws on unexpected response shape', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'something' }), { status: 200 }),
      );

      await expect(embedBatch(['code'])).rejects.toThrow('missing "data" array');
    });

    it('preserves order by sorting on response index', async () => {
      const reversed = {
        data: [
          { embedding: [2, 2, 2], index: 1 },
          { embedding: [1, 1, 1], index: 0 },
        ],
        model: 'voyage-code-3',
        usage: { total_tokens: 100 },
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(reversed), { status: 200 }),
      );

      const result = await embedBatch(['first', 'second']);

      expect(result[0]).toEqual([1, 1, 1]);
      expect(result[1]).toEqual([2, 2, 2]);
    });
  });

  describe('embedChunks', () => {
    it('returns empty array for empty input', async () => {
      const result = await embedChunks([]);
      expect(result).toEqual([]);
    });

    it('embeds small batch in single request', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockOkResponse(5));

      const chunks = Array.from({ length: 5 }, (_, i) => makeChunk(`code ${i}`));
      const result = await embedChunks(chunks);

      expect(result).toHaveLength(5);
      expect(fetch).toHaveBeenCalledOnce();
    });

    it('splits into multiple batches when exceeding BATCH_SIZE', async () => {
      const overflow = 50;
      const total = BATCH_SIZE + overflow;
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockResolvedValueOnce(mockOkResponse(BATCH_SIZE))
        .mockResolvedValueOnce(mockOkResponse(overflow));

      const chunks = Array.from({ length: total }, (_, i) => makeChunk(`code ${i}`));
      const result = await embedChunks(chunks);

      expect(result).toHaveLength(total);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('sends input_type document for chunks', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockOkResponse(1));

      await embedChunks([makeChunk('code')]);

      expect(getRequestBody().input_type).toBe('document');
    });

    it('limits concurrent requests to MAX_CONCURRENCY', async () => {
      const totalChunks = BATCH_SIZE * (MAX_CONCURRENCY + 2);

      let inflight = 0;
      let peakInflight = 0;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, _opts) => {
        inflight++;
        peakInflight = Math.max(peakInflight, inflight);
        // Simulate network delay so concurrent calls overlap
        await new Promise((r) => setTimeout(r, 10));
        inflight--;
        const body = JSON.parse((_opts as RequestInit).body as string);
        return new Response(JSON.stringify(makeVoyageResponse(body.input.length)), {
          status: 200,
        });
      });

      const chunks = Array.from({ length: totalChunks }, (_, i) => makeChunk(`code ${i}`));
      const result = await embedChunks(chunks);

      expect(result).toHaveLength(totalChunks);
      expect(peakInflight).toBeLessThanOrEqual(MAX_CONCURRENCY);
      expect(peakInflight).toBeGreaterThan(1);
    });

    it('preserves chunk order across concurrent batches', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockResolvedValueOnce(mockOkResponse(BATCH_SIZE))
        .mockResolvedValueOnce(mockOkResponse(1));

      const chunks = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => makeChunk(`code ${i}`));
      const result = await embedChunks(chunks);

      expect(result).toHaveLength(BATCH_SIZE + 1);
      expect(result[BATCH_SIZE]).toHaveLength(1024);
    });
  });

  describe('embedQuery', () => {
    it('returns a single embedding with input_type query', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockOkResponse(1));

      const result = await embedQuery('where is auth handled');

      expect(result).toHaveLength(1024);
      expect(getRequestBody().input_type).toBe('query');
    });

    it('throws when API returns empty data array', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [], model: 'voyage-code-3', usage: { total_tokens: 0 } }),
          { status: 200 },
        ),
      );

      await expect(embedQuery('test')).rejects.toThrow('returned no embedding');
    });
  });
});
