import type { Tool } from './types';
import { db } from '../db/client';
import { chunks } from '../db/schema';
import { eq } from 'drizzle-orm';

interface GetChunkParams { chunkId: string; [key: string]: unknown; }

interface GetChunkResult {
  chunk: { id: string; content: string; parentId: string | null; documentId: string; tokenCount: number; };
  parentText: string | null;
}

export const getChunkTool: Tool<GetChunkParams, GetChunkResult | { error: string }> = {
  name: 'get_chunk',
  description: '获取指定 chunk 及其 parent 上下文。当需要查看完整段落、补充上下文时使用。',
  parameters: {
    type: 'object',
    properties: { chunkId: { type: 'string', description: 'Chunk ID（UUID 格式）' } },
    required: ['chunkId'],
  },
  async execute(params: GetChunkParams) {
    const chunk = await db.query.chunks.findFirst({ where: eq(chunks.id, params.chunkId) });
    if (!chunk) return { error: 'Chunk not found', chunkId: params.chunkId };
    let parentText: string | null = null;
    if (chunk.parentId) {
      const parent = await db.query.chunks.findFirst({ where: eq(chunks.id, chunk.parentId) });
      parentText = parent?.content ?? null;
    }
    return {
      chunk: { id: chunk.id, content: chunk.content, parentId: chunk.parentId, documentId: chunk.documentId, tokenCount: chunk.tokenCount },
      parentText,
    };
  },
};
