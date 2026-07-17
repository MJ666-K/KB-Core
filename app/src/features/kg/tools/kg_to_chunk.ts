import type { Tool } from '@features/kb/tools/types';
import { eq } from 'drizzle-orm';
import { db } from '@core/db/client';
import { chunks, documents } from '@core/db/schema';
import { withSession } from '../client';
import { logger } from '@core/utils/logger';
import { config } from '@core/config';

interface Params { nodeId: string }

interface Result {
  nodeId: string;
  nodeLabel: string | null;
  chunkId: string | null;
  docId: string | null;
  docTitle: string | null;
  text: string | null;
}

/**
 * 图谱节点 → 关联的 Postgres chunk 原文
 * 走两步：
 *   1. Neo4j 查节点的 chunkId
 *   2. Postgres 查 chunk + 关联 document title
 */
export const kgToChunkTool: Tool<Params, Result> = {
  name: 'kg_to_chunk',
  description: '把知识图谱节点反向关联到 Postgres 里对应的 chunk 原文（一般是法条节点的 law 字段切片）。',
  parameters: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '知识图谱节点 id（如 law_labor_dispute_mediation）' },
    },
    required: ['nodeId'],
  },
  async execute(params: Params): Promise<Result> {
    const empty: Result = {
      nodeId: params.nodeId,
      nodeLabel: null,
      chunkId: null,
      docId: null,
      docTitle: null,
      text: null,
    };
    if (!config.kgEnabled) return empty;

    let nodeLabel: string | null = null;
    let chunkId: string | null = null;
    await withSession(async (session) => {
      const r = await session.run(
        `MATCH (n {id: $id}) RETURN n.label AS label, n.chunkId AS chunkId`,
        { id: params.nodeId },
      );
      if (r.records.length > 0) {
        nodeLabel = r.records[0]!.get('label');
        const cid = r.records[0]!.get('chunkId');
        chunkId = cid ?? null;
      }
    });
    if (!chunkId) {
      logger.info('[kg] kg_to_chunk no chunkId', { nodeId: params.nodeId });
      return { ...empty, nodeLabel };
    }

    const row = await db
      .select({
        chunkId: chunks.id,
        content: chunks.content,
        documentId: chunks.documentId,
        docTitle: documents.title,
      })
      .from(chunks)
      .leftJoin(documents, eq(chunks.documentId, documents.id))
      .where(eq(chunks.id, chunkId))
      .limit(1);

    if (row.length === 0) {
      logger.warn('[kg] kg_to_chunk chunk not found', { nodeId: params.nodeId, chunkId });
      return { ...empty, nodeLabel, chunkId };
    }
    const r = row[0]!;
    logger.info('[kg] kg_to_chunk', { nodeId: params.nodeId, chunkId });
    return {
      nodeId: params.nodeId,
      nodeLabel,
      chunkId: r.chunkId,
      docId: r.documentId,
      docTitle: r.docTitle ?? null,
      text: r.content,
    };
  },
};