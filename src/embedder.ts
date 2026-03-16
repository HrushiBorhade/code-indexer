import env from './env.ts';
import type { Chunk } from './chunker/types.ts';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-code-3';
const BATCH_SIZE = 128;
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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedBatch(
  texts: string[],
  inputType: 'document' | 'query' = 'document',
): Promise<number[][]> {
  if (texts.length === 0) return [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(VOYAGE_API_URL, {
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

    if (response.status === 429) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`Voyage API rate limit exceeded after ${MAX_RETRIES + 1} attempts`);
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[embedder] Rate limited (429). Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`,
      );
      await sleep(delay);
      continue;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Voyage API error ${response.status}: ${body}`);
    }

    const json = (await response.json()) as VoyageResponse;
    const sorted = json.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }

  throw new Error('embedBatch: unexpected exit from retry loop');
}

async function embedChunks(chunks: Chunk[]): Promise<number[][]> {
  if (chunks.length === 0) return [];

  const texts = chunks.map((c) => c.content);
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(texts.length / BATCH_SIZE);

    console.log(
      `[embedder] Embedding batch ${batchNum}/${totalBatches} (${batch.length} chunks)...`,
    );

    const embeddings = await embedBatch(batch, 'document');
    allEmbeddings.push(...embeddings);
  }

  return allEmbeddings;
}

async function embedQuery(query: string): Promise<number[]> {
  const [embedding] = await embedBatch([query], 'query');
  return embedding;
}

export { embedBatch, embedChunks, embedQuery, sleep, BATCH_SIZE };
