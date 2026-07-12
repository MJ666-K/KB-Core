import type { Tool } from '../../tools/types';
import { withSession, cypherNodeProjection, nodeToPlain } from '../client';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import type { KgNode, KgNodeType } from '../client';

interface Params {
  keyword: string;
  type?: KgNodeType;
  category?: string;
  limit?: number;
}

interface Result { nodes: KgNode[] }

export const kgSearchNodesTool: Tool<Params, Result> = {
  name: 'kg_search_nodes',
  description: '按关键词在 Neo4j 知识图谱中搜索节点。可选按节点类型（Flow/Law/Evidence/Case）和 category 过滤。',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '搜索关键词，匹配节点 label / category（全文索引）' },
      type:    { type: 'string', description: '节点类型过滤', enum: ['Flow', 'Law', 'Evidence', 'Case'] },
      category: { type: 'string', description: '业务分类过滤，如 "劳动调解"' },
      limit: { type: 'number', description: '返回数量上限，默认 20', default: 20 },
    },
    required: ['keyword'],
  },
  async execute(params: Params) {
    if (!config.kgEnabled) return { nodes: [] };
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
    return await withSession(async (session) => {
      // 用全文索引（Neo4j 5.x）：先用全文查 id 集合，再 OPTIONAL MATCH 拿完整属性
      const result = await session.run(
        `
        CALL db.index.fulltext.queryNodes('node_fulltext', $kw) YIELD node, score
        WHERE ($type IS NULL OR labels(node)[0] = $type)
          AND ($category IS NULL OR node.category = $category)
        RETURN ${cypherNodeProjection('node')} AS n
        ORDER BY score DESC
        LIMIT toInteger($limit)
        `,
        { kw: params.keyword, type: params.type ?? null, category: params.category ?? null, limit },
      );
      const nodes: KgNode[] = result.records.map((r) => nodeToPlain(r.get('n')));
      logger.info('[kg] kg_search_nodes', { kw: params.keyword, hits: nodes.length });
      return { nodes };
    });
  },
};