import { config } from '../config';
import { TTLCache } from '../cache/ttl-cache';
import { logger } from '../utils/logger';

export class EmbeddingService {
  private queryCache = new TTLCache<string, number[]>(
    600_000,
    config.embeddingCacheMax,
  );

  async embedQuery(text: string): Promise<number[]> {
    const cached = this.queryCache.get(text);
    if (cached) return cached;
    const vectors = await this.callApi([text]);
    const vec = vectors[0]!;
    this.queryCache.set(text, vec);
    return vec;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const results: number[][] = [];
    const batchSize = config.embeddingBatchSize;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const vectors = await this.callApi(batch);
      results.push(...vectors);
    }
    return results;
  }

  private async callApi(texts: string[]): Promise<number[][]> {
    const url = `${config.embeddingApiUrl}/embeddings`;
    const opts: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.embeddingApiKey}`,
      },
      body: JSON.stringify({
        model: config.embeddingModelId,
        input: texts,
      }),
    };

    let res: Response | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        res = await fetch(url, opts);
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        const delay = Math.pow(2, attempt) * 1000;
        logger.warn(`[Embedding] attempt ${attempt} failed, retry in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    if (!res) throw new Error('Embedding fetch failed after retries');

    if (!res!.ok) {
      const errorBody = await res.text();
      logger.error('Embedding API error', { status: res.status, body: errorBody });
      throw new Error(`Embedding API error: ${res.status} ${errorBody}`);
    }

    const json = await res.json() as {
      data: Array<{ embedding: number[] }>;
    };

    if (!json.data || json.data.length !== texts.length) {
      throw new Error(
        `Embedding API returned ${json.data?.length} vectors, expected ${texts.length}`,
      );
    }

    return json.data.map(d => d.embedding);
  }
}
