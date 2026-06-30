import type { Tool, ToolContext } from './types';
import type { HybridRetriever, RetrievalResult } from '../retrieve/retriever';

let retrieverInstance: HybridRetriever | null = null;

export function setRetriever(r: HybridRetriever): void { retrieverInstance = r; }

interface SearchParams { query: string; topK?: number; [key: string]: unknown; }

export const searchKnowledgeTool: Tool<SearchParams, RetrievalResult[]> = {
  name: 'search_knowledge',
  description: '搜索知识库，返回相关文档片段。用于回答事实性问题、查找资料、获取上下文。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词或问题（用自然语言，会做语义检索）' },
      topK: { type: 'number', description: '返回结果数量，默认 5。范围 1-20。', default: 5 },
    },
    required: ['query'],
  },
  async execute(params: SearchParams, ctx: ToolContext): Promise<RetrievalResult[]> {
    if (!retrieverInstance) throw new Error('Retriever not initialized. Call setRetriever() first.');
    const topK = Math.min(Math.max(params.topK ?? 5, 1), 20);
    return retrieverInstance.retrieve(params.query, { datasetId: ctx.datasetId, topK });
  },
};
