import { randomUUID } from 'node:crypto';
import env from '../config/env.ts';
import { createLogger } from '../utils/logger.ts';
import { getProvider } from './embedder.ts';

const log = createLogger('store');

const COLLECTION_NAME = 'code-indexer';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

interface PointPayload {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  language: string;
  chunkHash: string;
}

interface SearchResult {
  id: string;
  score: number;
  payload: PointPayload;
}

let cachedQdrantConfig: { url: string; apiKey: string } | null = null;

function getQdrantConfig(): { url: string; apiKey: string } {
  if (cachedQdrantConfig) return cachedQdrantConfig;

  const url = env.QDRANT_URL;
  const apiKey = env.QDRANT_KEY;
  if (!url || !apiKey) {
    throw new Error(
      'QDRANT_URL and QDRANT_KEY are required for vector store. Set them in your .env file.',
    );
  }
  cachedQdrantConfig = { url, apiKey };
  return cachedQdrantConfig;
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function sleepWithJitter(baseMs: number): Promise<void> {
  const jittered = Math.floor(baseMs * (0.5 + Math.random()));
  return new Promise((resolve) => setTimeout(resolve, jittered));
}

async function qdrantRequest(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const { url, apiKey } = getQdrantConfig();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;

    try {
      response = await fetch(`${url}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err: unknown) {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `Qdrant network error after ${MAX_RETRIES + 1} attempts: ${err instanceof Error ? err.message : err}`,
          { cause: err },
        );
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      log.warn(
        `Qdrant network error. Retrying in ~${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES + 1})...`,
      );
      await sleepWithJitter(delay);
      continue;
    }

    if (isRetryable(response.status)) {
      if (attempt === MAX_RETRIES) {
        const text = await response.text();
        throw new Error(`Qdrant ${response.status} after ${MAX_RETRIES + 1} attempts: ${text}`);
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      log.warn(
        `Qdrant ${response.status}. Retrying in ~${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES + 1})...`,
      );
      await sleepWithJitter(delay);
      continue;
    }

    // Parse response body safely — not all error responses are JSON
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = await response.text();
    }

    return { status: response.status, data };
  }

  throw new Error('Unreachable');
}

async function ensureCollection(): Promise<void> {
  const provider = getProvider();
  const dimension = provider.dimension;

  const { status, data } = await qdrantRequest(`/collections/${COLLECTION_NAME}`, 'GET');

  if (status === 200) {
    log.info(`Collection "${COLLECTION_NAME}" already exists`);
    return;
  }

  if (status !== 404) {
    throw new Error(
      `Qdrant collection check failed with status ${status}: ${JSON.stringify(data)}`,
    );
  }

  const { status: createStatus, data: createData } = await qdrantRequest(
    `/collections/${COLLECTION_NAME}`,
    'PUT',
    {
      vectors: {
        size: dimension,
        distance: 'Cosine',
      },
    },
  );

  if (createStatus !== 200) {
    throw new Error(`Failed to create Qdrant collection: ${JSON.stringify(createData)}`);
  }

  log.info(`Created collection "${COLLECTION_NAME}" (${dimension} dimensions, cosine distance)`);
}

interface UpsertPoint {
  embedding: number[];
  payload: PointPayload;
}

async function upsertPoints(points: UpsertPoint[]): Promise<string[]> {
  if (points.length === 0) return [];

  const ids = points.map(() => randomUUID());

  const qdrantPoints = points.map((p, i) => ({
    id: ids[i],
    vector: p.embedding,
    payload: p.payload,
  }));

  const BATCH_SIZE = 100;
  for (let i = 0; i < qdrantPoints.length; i += BATCH_SIZE) {
    const batch = qdrantPoints.slice(i, i + BATCH_SIZE);
    const { status, data } = await qdrantRequest(`/collections/${COLLECTION_NAME}/points`, 'PUT', {
      points: batch,
    });

    if (status !== 200) {
      throw new Error(`Failed to upsert points to Qdrant: ${JSON.stringify(data)}`);
    }

    log.info(
      `Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(qdrantPoints.length / BATCH_SIZE)} (${batch.length} points)`,
    );
  }

  return ids;
}

async function deletePoints(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const { status, data } = await qdrantRequest(
    `/collections/${COLLECTION_NAME}/points/delete`,
    'POST',
    { points: ids },
  );

  if (status !== 200) {
    throw new Error(`Failed to delete points from Qdrant: ${JSON.stringify(data)}`);
  }

  log.info(`Deleted ${ids.length} points from Qdrant`);
}

async function searchPoints(vector: number[], limit: number = 10): Promise<SearchResult[]> {
  const { status, data } = await qdrantRequest(
    `/collections/${COLLECTION_NAME}/points/search`,
    'POST',
    {
      vector,
      limit,
      with_payload: true,
    },
  );

  if (status !== 200) {
    throw new Error(`Qdrant search failed: ${JSON.stringify(data)}`);
  }

  const result = data as { result: SearchResult[] };
  return result.result;
}

export { ensureCollection, upsertPoints, deletePoints, searchPoints, COLLECTION_NAME };
export type { PointPayload, SearchResult, UpsertPoint };
