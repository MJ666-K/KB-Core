import type { Tool, ToolContext } from './types';
import { db } from '../db/client';
import { documents } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';

interface GetDocumentParams { documentId: string; [key: string]: unknown; }

export const getDocumentTool: Tool<GetDocumentParams> = {
  name: 'get_document',
  description: '获取文档的完整元数据（标题、状态、大小、入库时间等）。当 chunk 信息不够、需要查看文档整体时使用。',
  parameters: {
    type: 'object',
    properties: { documentId: { type: 'string', description: '文档 ID（UUID 格式）' } },
    required: ['documentId'],
  },
  async execute(params: GetDocumentParams, ctx: ToolContext) {
    const doc = await db.query.documents.findFirst({
      where: and(
        eq(documents.id, params.documentId),
        eq(documents.datasetId, ctx.datasetId),
        isNull(documents.deletedAt),
      ),
    });
    if (!doc) return { error: 'Document not found', documentId: params.documentId };
    return doc;
  },
};
