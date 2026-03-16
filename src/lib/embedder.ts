import env from '../config/env.ts';
import type { Chunk } from '../chunker/types.ts';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('embedder');

interface EmbeddingProvider {
  name: string;
  apiUrl: string;
  model: string;
  dimension: number;
  apiKey: string;
  batchSize: number;
  maxConcurrency: number;
  interBatchDelayMs: number;
  supportsInputType: boolean;
}

interface EmbeddingRequest {
  input: string[];
  model: string;
  input_type?: string;
}

interface EmbeddingData {
  embedding: number[];
  index: number;
}

interface EmbeddingResponse {
  data: EmbeddingData[];
  model: string;
  usage: { total_tokens: number };
}

let cachedProvider: EmbeddingProvider | null = null;

function getProvider(): EmbeddingProvider {
  if (cachedProvider) return cachedProvider;

  const provider = env.EMBEDDING_PROVIDER;

  if (provider === 'openai') {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai. Set it in your .env file.',
      );
    }
    cachedProvider = {
      name: 'openai',
      apiUrl: 'https://api.openai.com/v1/embeddings',
      model: 'text-embedding-3-small',
      dimension: 1536,
      apiKey,
      batchSize: 128,
      maxConcurrency: 3,
      interBatchDelayMs: 0,
      supportsInputType: false,
    };
    return cachedProvider;
  } else if (provider !== 'voyage') {
    throw new Error(`Unknown embedding provider: "${provider}". Supported: openai, voyage.`);
  }

  const apiKey = env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'VOYAGE_API_KEY is required when EMBEDDING_PROVIDER=voyage. Set it in your .env file.',
    );
  }
  cachedProvider = {
    name: 'voyage',
    apiUrl: 'https://api.voyageai.com/v1/embeddings',
    model: 'voyage-code-3',
    dimension: 1024,
    apiKey,
    batchSize: 8,
    maxConcurrency: 1,
    interBatchDelayMs: 5000,
    supportsInputType: true,
  };
  return cachedProvider;
}

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;
const MAX_CHARS_PER_CHUNK = 20_000;

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function sleepWithJitter(baseMs: number): Promise<void> {
  const jittered = Math.floor(baseMs * (0.5 + Math.random()));
  return new Promise((resolve) => setTimeout(resolve, jittered));
}

function truncateTexts(texts: string[]): string[] {
  return texts.map((t, i) => {
    if (t.length > MAX_CHARS_PER_CHUNK) {
      log.warn(`Chunk ${i} truncated from ${t.length} to ${MAX_CHARS_PER_CHUNK} chars`);
      return t.slice(0, MAX_CHARS_PER_CHUNK);
    }
    return t;
  });
}

async function embedBatch(
  texts: string[],
  provider: EmbeddingProvider,
  inputType: 'document' | 'query' = 'document',
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const safeTexts = truncateTexts(texts);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;

    const body: EmbeddingRequest = {
      input: safeTexts,
      model: provider.model,
    };
    if (provider.supportsInputType) {
      body.input_type = inputType;
    }

    try {
      response = await fetch(provider.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `${provider.name} API network error after ${MAX_RETRIES + 1} attempts: ${err instanceof Error ? err.message : err}`,
          { cause: err },
        );
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      log.warn(
        `Network error. Retrying in ~${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES + 1})...`,
      );
      await sleepWithJitter(delay);
      continue;
    }

    if (isRetryable(response.status)) {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `${provider.name} API error ${response.status} after ${MAX_RETRIES + 1} attempts`,
        );
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      log.warn(
        `${response.status} response. Retrying in ~${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES + 1})...`,
      );
      await sleepWithJitter(delay);
      continue;
    }

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`${provider.name} API error ${response.status}: ${responseBody}`);
    }

    const json = (await response.json()) as EmbeddingResponse;

    if (!Array.isArray(json.data)) {
      throw new Error(`${provider.name} API returned unexpected response: missing "data" array`);
    }

    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      if (!Array.isArray(item.embedding) || typeof item.index !== 'number') {
        throw new Error(
          `${provider.name} API returned malformed embedding: expected {embedding: number[], index: number}`,
        );
      }
    }
    return sorted.map((d) => d.embedding);
  }

  throw new Error('Unreachable');
}

async function embedChunks(chunks: Chunk[]): Promise<number[][]> {
  if (chunks.length === 0) return [];

  const provider = getProvider();
  log.info(`Using ${provider.name} (${provider.model}) for embedding`);

  const texts = chunks.map((c) => c.content);
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += provider.batchSize) {
    batches.push(texts.slice(i, i + provider.batchSize));
  }

  const totalBatches = batches.length;
  const results: number[][][] = new Array(totalBatches);

  for (let i = 0; i < totalBatches; i += provider.maxConcurrency) {
    if (i > 0 && provider.interBatchDelayMs > 0) {
      await sleepWithJitter(provider.interBatchDelayMs);
    }

    const concurrentBatches = batches.slice(i, i + provider.maxConcurrency);
    const promises = concurrentBatches.map((batch, j) => {
      const batchNum = i + j + 1;
      log.info(`Embedding batch ${batchNum}/${totalBatches} (${batch.length} chunks)...`);
      return embedBatch(batch, provider, 'document');
    });

    const windowResults = await Promise.all(promises);
    for (let j = 0; j < windowResults.length; j++) {
      results[i + j] = windowResults[j];
    }
  }

  const missing = results.findIndex((r) => r === undefined);
  if (missing !== -1) {
    throw new Error(`[embedder] BUG: batch ${missing + 1} has no embeddings after processing`);
  }

  return results.flat();
}

async function embedQuery(query: string): Promise<number[]> {
  const provider = getProvider();
  const [embedding] = await embedBatch([query], provider, 'query');
  if (!embedding) {
    throw new Error('[embedder] API returned no embedding for query');
  }
  return embedding;
}

export { embedBatch, embedChunks, embedQuery, getProvider };
export type { EmbeddingProvider };
