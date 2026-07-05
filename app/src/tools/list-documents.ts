import type { Tool, ToolContext } from './types';
import { db } from '../db/client';
import { documents } from '../db/schema';
import { eq, isNull, desc, and, inArray } from 'drizzle-orm';

interface ListParams { limit?: number; [key: string]: unknown; }

export const listDocumentsTool: Tool<ListParams> = {
  name: 'list_documents',
  description: '列出当前知识库的所有文档（按入库时间倒序）。用于"有哪些资料""列出文档"类请求。',
  parameters: {
    type: 'object',
    properties: { limit: { type: 'number', description: '返回数量，默认 20，最大 100', default: 20 } },
    required: [],
  },
  async execute(params: ListParams, ctx: ToolContext) {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const ids = ctx.datasetIds && ctx.datasetIds.length > 0 ? ctx.datasetIds : [ctx.datasetId];
    const datasetFilter = ids.length === 1
      ? eq(documents.datasetId, ids[0]!)
      : inArray(documents.datasetId, [...ids]);
    const docs = await db.select({
      id: documents.id, title: documents.title, docType: documents.docType,
      status: documents.status, fileSize: documents.fileSize, createdAt: documents.createdAt,
    }).from(documents).where(and(
      datasetFilter,
      isNull(documents.deletedAt),
      eq(documents.status, 'ready'),
    )).orderBy(desc(documents.createdAt)).limit(limit);
    return { documents: docs, total: docs.length };
  },
};
