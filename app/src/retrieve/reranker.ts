import { config } from '../config';
import { logger } from '../utils/logger';

export interface RerankCandidate {
  chunkId: string;
  parentId: string | null;
  documentId: string;
  text: string;
  score: number;
}

export interface Reranker {
  rank(query: string, candidates: RerankCandidate[], topK?: number): Promise<RerankCandidate[]>;
}

export class ApiReranker implements Reranker {
  private readonly maxDocChars = 8000;

  async rank(query: string, candidates: RerankCandidate[], topK?: number): Promise<RerankCandidate[]> {
    if (candidates.length <= 1) return candidates;
    const limit = topK ?? candidates.length;

    try {
      const documents = candidates.map(c => c.text.slice(0, this.maxDocChars));

      const res = await fetch(config.rerankApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.rerankApiKey}`,
        },
        body: JSON.stringify({
          model: config.rerankModelId,
          input: {
            query,
            documents,
          },
          parameters: {
            top_n: limit,
            return_documents: false,
          },
        }),
      });

      if (!res.ok) throw new Error(`Rerank API ${res.status}: ${await res.text()}`);

      const json = await res.json() as {
        output?: {
          results?: Array<{ index: number; relevance_score: number }>;
        };
        results?: Array<{ index: number; relevance_score: number }>;
      };

      const results = json.output?.results ?? json.results ?? [];
      if (results.length === 0) return candidates.slice(0, limit);

      return results.map(r => ({ ...candidates[r.index]!, score: r.relevance_score }));
    } catch (err) {
      logger.warn('Rerank failed, falling back to original order', err);
      return candidates.slice(0, limit);
    }
  }
}

export class PassThroughReranker implements Reranker {
  async rank(_: string, candidates: RerankCandidate[], topK?: number): Promise<RerankCandidate[]> {
    return candidates.slice(0, topK ?? candidates.length);
  }
}
