import type { Tool } from '../../tools/types';
import { withSession, type KgNode, type KgEdge, cypherNodeProjection, nodeToPlain } from '../client';
import { logger } from '../../utils/logger';
import { config } from '../../config';

interface Params { id: string }
interface Result {
  node: KgNode | null;
  incoming: KgEdge[];
  outgoing: KgEdge[];
}

export const kgGetNodeTool: Tool<Params, Result> = {
  name: 'kg_get_node',
  description: '获取单个节点的完整信息 + 一跳入边/出边。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '节点 id（如 flow_labor_apply）' },
    },
    required: ['id'],
  },
  async execute(params: Params) {
    if (!config.kgEnabled) return { node: null, incoming: [], outgoing: [] };
    return await withSession(async (session) => {
      const nodeRes = await session.run(
        `
        MATCH (n {id: $id})
        RETURN ${cypherNodeProjection('n')} AS n
        LIMIT 1
        `,
        { id: params.id },
      );
      const raw = nodeRes.records[0]?.get('n') ?? null;
      const node = raw ? nodeToPlain(raw) : null;

      const edgesRes = await session.run(
        `
        MATCH (n {id: $id})-[r]-(m)
        RETURN
          CASE WHEN startNode(r) = n THEN 'out' ELSE 'in' END AS dir,
          { from: startNode(r).id,
            to:   endNode(r).id,
            type: type(r),
            solid: r.solid,
            label: r.label } AS e
        `,
        { id: params.id },
      );

      const incoming: KgEdge[] = [];
      const outgoing: KgEdge[] = [];
      for (const rec of edgesRes.records) {
        const dir = rec.get('dir');
        const e = rec.get('e');
        if (dir === 'out') outgoing.push(e); else incoming.push(e);
      }
      logger.info('[kg] kg_get_node', { id: params.id, found: !!node, in: incoming.length, out: outgoing.length });
      return { node, incoming, outgoing };
    });
  },
};
