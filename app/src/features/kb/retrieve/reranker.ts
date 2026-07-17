import { config } from '@core/config';
import { logger } from '@core/utils/logger';

export interface RerankCandidate {
  chunkId: string;
  parentId: string | null;
  documentId: string;
  text: string;
  score: number;
}

export interface RerankResult {
  results: RerankCandidate[];
  fallback: boolean;
}

export interface Reranker {
  rank(query: string, candidates: RerankCandidate[], topK?: number): Promise<RerankResult>;
}

export class ApiReranker implements Reranker {
  private readonly maxDocChars = 8000;
  private readonly defaultInstruct = 'Given a web search query, retrieve relevant passages that answer the query.';

  async rank(query: string, candidates: RerankCandidate[], topK?: number): Promise<RerankResult> {
    if (candidates.length <= 1) return { results: candidates, fallback: true };
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
          query,
          documents,
          top_n: limit,
          return_documents: false,
          instruct: this.defaultInstruct,
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
      if (results.length === 0) return { results: candidates.slice(0, limit), fallback: true };

      const ranked = results.map(r => ({ ...candidates[r.index]!, score: r.relevance_score }));
      return { results: ranked, fallback: false };
    } catch (err) {
      logger.warn('Rerank failed, falling back to original order', err);
      return { results: candidates.slice(0, limit), fallback: true };
    }
  }
}

export class PassThroughReranker implements Reranker {
  async rank(_: string, candidates: RerankCandidate[], topK?: number): Promise<RerankResult> {
    return { results: candidates.slice(0, topK ?? candidates.length), fallback: true };
  }
}
