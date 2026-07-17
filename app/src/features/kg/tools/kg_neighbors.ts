import type { Tool } from '@features/kb/tools/types';
import { withSession, type KgNode, type KgEdge, cypherNodeProjection, nodeToPlain } from '../client';
import { logger } from '@core/utils/logger';
import { config } from '@core/config';

interface Params {
  id: string;
  edgeType?: string;
  direction?: 'out' | 'in' | 'both';
  solid?: boolean;
  limit?: number;
}

interface Result {
  nodes: KgNode[];
  edges: KgEdge[];
}

export const kgNeighborsTool: Tool<Params, Result> = {
  name: 'kg_neighbors',
  description: '获取节点的一跳邻居。支持按关系类型（NEXT/APPLIES_TO/REQUIRES 等）、方向、solid/dashed 过滤。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '节点 id' },
      edgeType: { type: 'string', description: '关系类型枚举（可选），如 NEXT/APPLIES_TO/REQUIRES/REFERS_TO/CITES/KEY_EVIDENCE' },
      direction: { type: 'string', description: '方向：out 出边 / in 入边 / both 双向，默认 out', enum: ['out', 'in', 'both'], default: 'out' },
      solid: { type: 'boolean', description: '按实线/虚线过滤（true=实线，false=虚线）' },
      limit: { type: 'number', description: '返回数量上限，默认 50', default: 50 },
    },
    required: ['id'],
  },
  async execute(params: Params) {
    if (!config.kgEnabled) return { nodes: [], edges: [] };
    const dir = params.direction ?? 'out';
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);

    // 不同方向的 Cypher
    const pattern = dir === 'out' ? '(n)-[r]->(m)'
                  : dir === 'in'  ? '(n)<-[r]-(m)'
                  :                  '(n)-[r]-(m)';

    return await withSession(async (session) => {
      const result = await session.run(
        `
        MATCH ${pattern}
        WHERE n.id = $id
          AND ($edgeType IS NULL OR type(r) = $edgeType)
          AND ($solid    IS NULL OR r.solid  = $solid)
        RETURN
          ${cypherNodeProjection('m')} AS m,
          { from: startNode(r).id,
            to:   endNode(r).id,
            type: type(r),
            solid: r.solid,
            label: r.label } AS e
        LIMIT toInteger($limit)
        `,
        {
          id: params.id,
          edgeType: params.edgeType ?? null,
          solid: params.solid ?? null,
          limit,
        },
      );

      const nodes: KgNode[] = [];
      const edges: KgEdge[] = [];
      const seen = new Set<string>();
      for (const rec of result.records) {
        const m = nodeToPlain(rec.get('m'));
        if (!seen.has(m.id)) {
          nodes.push(m);
          seen.add(m.id);
        }
        edges.push(rec.get('e'));
      }
      logger.info('[kg] kg_neighbors', { id: params.id, dir, hits: nodes.length });
      return { nodes, edges };
    });
  },
};