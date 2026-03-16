import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../config/env.ts', () => ({
  default: {
    EMBEDDING_PROVIDER: 'openai',
    OPENAI_API_KEY: 'test-key',
    NODE_ENV: 'test',
  },
}));

import { embedBatch, embedChunks, embedQuery, getProvider } from './embedder.ts';
import type { Chunk } from '../chunker/types.ts';

const provider = getProvider();

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

function makeEmbeddingResponse(count: number) {
  return {
    data: Array.from({ length: count }, (_, i) => ({
      embedding: Array.from({ length: 1024 }, (__, d) => i * 0.001 + d * 0.0001),
      index: i,
    })),
    model: provider.model,
    usage: { total_tokens: count * 50 },
  };
}

function mockOkResponse(count: number): Response {
  return new Response(JSON.stringify(makeEmbeddingResponse(count)), { status: 200 });
}

function getRequestBody(callIndex = 0) {
  return JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[callIndex][1].body);
}

describe('embedder', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getProvider', () => {
    it('returns openai provider config', () => {
      expect(provider.name).toBe('openai');
      expect(provider.apiUrl).toContain('openai.com');
      expect(provider.model).toBe('text-embedding-3-small');
      expect(provider.supportsInputType).toBe(false);
    });
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

    it('sends correct request to provider API', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockOkResponse(1));

      await embedBatch(['function hello() {}'], 'document');

      expect(fetch).toHaveBeenCalledWith(
        provider.apiUrl,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-key',
          },
        }),
      );

      const body = getRequestBody();
      expect(body.input).toEqual(['function hello() {}']);
      expect(body.model).toBe(provider.model);
    });

    it('omits input_type for providers that do not support it', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockOkResponse(1));

      await embedBatch(['code'], 'document');

      const body = getRequestBody();
      expect(body.input_type).toBeUndefined();
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

      await expect(embedBatch(['code'])).rejects.toThrow('error 429 after');
    }, 120_000);

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

      await expect(embedBatch(['code'])).rejects.toThrow('API error 400');
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
    }, 120_000);

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
        model: provider.model,
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

    it('splits into multiple batches when exceeding batch size', async () => {
      const { batchSize } = provider;
      const overflow = 50;
      const total = batchSize + overflow;
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockResolvedValueOnce(mockOkResponse(batchSize))
        .mockResolvedValueOnce(mockOkResponse(overflow));

      const chunks = Array.from({ length: total }, (_, i) => makeChunk(`code ${i}`));
      const result = await embedChunks(chunks);

      expect(result).toHaveLength(total);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('limits concurrent requests to maxConcurrency', async () => {
      const { batchSize, maxConcurrency } = provider;
      const totalChunks = batchSize * (maxConcurrency + 2);

      let inflight = 0;
      let peakInflight = 0;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, _opts) => {
        inflight++;
        peakInflight = Math.max(peakInflight, inflight);
        await new Promise((r) => setTimeout(r, 10));
        inflight--;
        const body = JSON.parse((_opts as RequestInit).body as string);
        return new Response(JSON.stringify(makeEmbeddingResponse(body.input.length)), {
          status: 200,
        });
      });

      const chunks = Array.from({ length: totalChunks }, (_, i) => makeChunk(`code ${i}`));
      const result = await embedChunks(chunks);

      expect(result).toHaveLength(totalChunks);
      expect(peakInflight).toBeLessThanOrEqual(maxConcurrency);
      expect(peakInflight).toBeGreaterThan(1);
    });

    it('preserves chunk order across concurrent batches', async () => {
      const { batchSize } = provider;
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockResolvedValueOnce(mockOkResponse(batchSize))
        .mockResolvedValueOnce(mockOkResponse(1));

      const chunks = Array.from({ length: batchSize + 1 }, (_, i) => makeChunk(`code ${i}`));
      const result = await embedChunks(chunks);

      expect(result).toHaveLength(batchSize + 1);
      expect(result[batchSize]).toHaveLength(1024);
    });
  });

  describe('embedQuery', () => {
    it('returns a single embedding', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockOkResponse(1));

      const result = await embedQuery('where is auth handled');

      expect(result).toHaveLength(1024);
    });

    it('throws when API returns empty data array', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [], model: provider.model, usage: { total_tokens: 0 } }),
          { status: 200 },
        ),
      );

      await expect(embedQuery('test')).rejects.toThrow('returned no embedding');
    });
  });
});
