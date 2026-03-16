import env from './env.ts';
import type { Chunk } from './chunker/types.ts';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-code-3';
const BATCH_SIZE = 128;
const MAX_CONCURRENCY = 3;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

interface VoyageEmbeddingData {
  embedding: number[];
  index: number;
}

interface VoyageResponse {
  data: VoyageEmbeddingData[];
  model: string;
  usage: { total_tokens: number };
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedBatch(
  texts: string[],
  inputType: 'document' | 'query' = 'document',
): Promise<number[][]> {
  if (texts.length === 0) return [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;

    try {
      response = await fetch(VOYAGE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
        },
        body: JSON.stringify({
          input: texts,
          model: VOYAGE_MODEL,
          input_type: inputType,
        }),
      });
    } catch (err: unknown) {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `Voyage API network error after ${MAX_RETRIES + 1} attempts: ${err instanceof Error ? err.message : err}`,
          { cause: err },
        );
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[embedder] Network error. Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`,
      );
      await sleep(delay);
      continue;
    }

    if (isRetryable(response.status)) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`Voyage API error ${response.status} after ${MAX_RETRIES + 1} attempts`);
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[embedder] ${response.status} response. Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`,
      );
      await sleep(delay);
      continue;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Voyage API error ${response.status}: ${body}`);
    }

    const json = (await response.json()) as VoyageResponse;

    if (!Array.isArray(json.data)) {
      throw new Error(`Voyage API returned unexpected response: missing "data" array`);
    }

    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }

  // Unreachable — loop always returns or throws, but TypeScript needs this
  throw new Error('Unreachable');
}

async function embedChunks(chunks: Chunk[]): Promise<number[][]> {
  if (chunks.length === 0) return [];

  const texts = chunks.map((c) => c.content);
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    batches.push(texts.slice(i, i + BATCH_SIZE));
  }

  const totalBatches = batches.length;
  const results: number[][][] = new Array(totalBatches);

  for (let i = 0; i < totalBatches; i += MAX_CONCURRENCY) {
    const window = batches.slice(i, i + MAX_CONCURRENCY);
    const promises = window.map((batch, j) => {
      const batchNum = i + j + 1;
      console.log(
        `[embedder] Embedding batch ${batchNum}/${totalBatches} (${batch.length} chunks)...`,
      );
      return embedBatch(batch, 'document');
    });

    const settled = await Promise.allSettled(promises);
    const failed: number[] = [];

    for (let j = 0; j < settled.length; j++) {
      const result = settled[j];
      if (result.status === 'fulfilled') {
        results[i + j] = result.value;
      } else {
        failed.push(i + j);
      }
    }

    // Retry failed batches sequentially (avoids concurrent retry stampede)
    for (const idx of failed) {
      console.warn(`[embedder] Retrying batch ${idx + 1}/${totalBatches} after window failure...`);
      results[idx] = await embedBatch(batches[idx], 'document');
    }
  }

  return results.flat();
}

async function embedQuery(query: string): Promise<number[]> {
  const [embedding] = await embedBatch([query], 'query');
  if (!embedding) {
    throw new Error('[embedder] Voyage API returned no embedding for query');
  }
  return embedding;
}

export { embedBatch, embedChunks, embedQuery, BATCH_SIZE, MAX_CONCURRENCY };
