import type { Tool, ToolContext } from './types';
import type { HybridRetriever, RetrievalResult, RetrievalDetails } from '../retrieve/retriever';
import { getQuerySettings } from '../settings/effective-config';
import { logger } from '../utils/logger';

let retrieverInstance: HybridRetriever | null = null;

export function setRetriever(r: HybridRetriever): void { retrieverInstance = r; }

const detailsBuffer: (RetrievalDetails & { results: RetrievalResult[] })[] = [];

export function drainRetrievalDetails(): RetrievalDetails[] {
  const out = [...detailsBuffer];
  detailsBuffer.length = 0;
  return out;
}

export function getLastRetrievalDetails(): (RetrievalDetails & { results: RetrievalResult[] }) | null {
  if (detailsBuffer.length === 0) {
    return null;
  }
  return detailsBuffer[detailsBuffer.length - 1]!;
}

const ARABIC_TO_CHINESE: Record<string, string> = {
  '0': '零', '1': '一', '2': '二', '3': '三', '4': '四',
  '5': '五', '6': '六', '7': '七', '8': '八', '9': '九',
};

const CHINESE_TO_ARABIC: Record<string, string> = Object.fromEntries(
  Object.entries(ARABIC_TO_CHINESE).map(([k, v]) => [v, k])
);

function normalizeQuery(query: string): string {
  const arabicPattern = /第(\d+)条/;
  const arabicMatch = query.match(arabicPattern);
  
  if (arabicMatch && arabicMatch[1]) {
    const numStr = arabicMatch[1];
    const chineseNum = arabicToChinese(numStr);
    return `${query} 第${chineseNum}条`;
  }
  
  const chinesePattern = /第([零一二三四五六七八九十百]+)条/;
  const chineseMatch = query.match(chinesePattern);
  
  if (chineseMatch && chineseMatch[1]) {
    const chineseNum = chineseMatch[1];
    const arabicNum = chineseToArabic(chineseNum);
    if (arabicNum !== chineseNum) {
      return `${query} 第${arabicNum}条`;
    }
  }
  
  return query;
}

function chineseToArabic(chinese: string): string {
  const units: Record<string, number> = {
    '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
    '十': 10, '百': 100,
  };
  
  let result = 0;
  let current = 0;
  let lastUnit = 1;
  
  for (const char of chinese) {
    const value = units[char];
    if (value === undefined) continue;
    
    if (value >= 10) {
      if (current === 0 && value === 10) {
        result += 1 * value;
      } else {
        result += current * value;
        current = 0;
      }
      lastUnit = value;
    } else {
      if (lastUnit === 10 && current === 0) {
        result += value;
      } else {
        current = value;
      }
    }
  }
  
  result += current;
  return result.toString();
}

function arabicToChinese(arabic: string): string {
  const num = parseInt(arabic, 10);
  if (Number.isNaN(num) || num < 0 || num > 999) return arabic;
  
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  
  if (num === 0) return '零';
  
  let result = '';
  
  if (num >= 100) {
    const hundreds = Math.floor(num / 100);
    result += digits[hundreds] + '百';
    const remainder = num % 100;
    if (remainder > 0 && remainder < 10) {
      result += '零';
    }
  }
  
  const remainder = num % 100;
  if (remainder >= 10) {
    const tens = Math.floor(remainder / 10);
    if (tens > 1) {
      result += digits[tens];
    }
    result += '十';
    const ones = remainder % 10;
    if (ones > 0) {
      result += digits[ones];
    }
  } else if (remainder > 0) {
    result += digits[remainder];
  }
  
  return result;
}

interface SearchParams { query: string; topK?: number; [key: string]: unknown; }

export const searchKnowledgeTool: Tool<SearchParams, RetrievalResult[]> = {
  name: 'search_knowledge',
  description: '搜索知识库，返回相关文档片段。用于回答事实性问题、查找资料、获取上下文。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词或问题（用自然语言，会做语义检索）。支持阿拉伯数字和中文数字，如"第39条"和"第三十九条"。' },
      topK: { type: 'number', description: '返回结果数量，默认 5。范围 1-20。', default: 5 },
    },
    required: ['query'],
  },
  async execute(params: SearchParams, ctx: ToolContext): Promise<RetrievalResult[]> {
    if (!retrieverInstance) throw new Error('Retriever not initialized. Call setRetriever() first.');
    const topK = Math.min(Math.max(params.topK ?? 5, 1), 20);
    const searchStart = Date.now();
    
    const normalizedQuery = normalizeQuery(params.query);
    if (normalizedQuery !== params.query) {
      logger.debug(`[检索] 查询规范化: "${params.query}" → "${normalizedQuery}"`);
    }
    
    logger.info(`[检索] 开始 search_knowledge`, {
      query: normalizedQuery.slice(0, 100),
      originalQuery: params.query !== normalizedQuery ? params.query.slice(0, 50) : undefined,
      topK,
      datasetId: ctx.datasetId?.slice(0, 8),
      datasetIds: ctx.datasetIds?.length ?? 0,
    });

    const { results, details } = await retrieverInstance.retrieveWithDetails(normalizedQuery, {
      datasetId: ctx.datasetId,
      datasetIds: ctx.datasetIds,
      topK,
    });

    const detailsWithResults = { ...details, results };
    detailsBuffer.push(detailsWithResults);

    if (ctx.events) {
      ctx.events.emit({
        type: 'retrieval_results',
        name: 'search_knowledge',
        results: results.map(r => ({
          chunkId: r.chunkId,
          text: r.text.slice(0, 500),
          score: r.score,
          documentTitle: r.documentTitle,
        })),
      });
    }

    const elapsed = Date.now() - searchStart;
    const q = getQuerySettings();
    logger.info(`[检索] search_knowledge 完成 (${elapsed}ms)`, {
      query: normalizedQuery.slice(0, 100),
      topK,
      thresholds: {
        denseMinSimilarity: q.denseMinSimilarity,
        rerankMinScore: q.rerankMinScore,
        denseTopKMultiplier: q.denseTopKMultiplier,
        rrfK: q.rrfK,
        rerankTopK: q.rerankTopK,
      },
      denseCount: details.denseCount,
      sparseCount: details.sparseCount,
      rrfCount: details.rrfCount,
      rerankCount: details.rerankCount,
      rerankFallback: details.rerankFallback,
      finalResults: results.length,
      topScores: details.candidates.slice(0, 3).map(c =>
        `${c.chunkId.slice(0, 8)}=d:${c.scores.dense?.toFixed(3) ?? '-'} s:${c.scores.sparse?.toFixed(2) ?? '-'} r:${c.scores.rerank?.toFixed(3) ?? c.scores.rrf.toFixed(4)}`,
      ).join(', '),
    });
    return results;
  },
};
