import type { Tool } from '@features/kb/tools/types';
import { withSession } from '../client';
import { logger } from '@core/utils/logger';
import { config } from '@core/config';

interface Params {
  fromId: string;
  toId: string;
  maxDepth?: number;
}

interface Result {
  found: boolean;
  length: number;
  nodes: Array<{ id: string; label: string; type: string }>;
  edges: Array<{ from: string; to: string; type: string; label: string | null; solid: boolean }>;
}

export const kgPathTool: Tool<Params, Result> = {
  name: 'kg_path',
  description: '在 Neo4j 中求两个节点之间的最短路径（无向 BFS）。用于回答"从 A 怎么到 B"。',
  parameters: {
    type: 'object',
    properties: {
      fromId: { type: 'string', description: '起点节点 id' },
      toId: { type: 'string', description: '终点节点 id' },
      maxDepth: { type: 'number', description: '最大搜索深度，默认 5', default: 5 },
    },
    required: ['fromId', 'toId'],
  },
  async execute(params: Params) {
    if (!config.kgEnabled) return { found: false, length: 0, nodes: [], edges: [] };
    const maxDepth = Math.min(Math.max(params.maxDepth ?? 5, 1), 10);
    return await withSession(async (session) => {
      const result = await session.run(
        `
        MATCH (a {id: $fromId}), (b {id: $toId})
        MATCH p = shortestPath((a)-[*..${maxDepth}]-(b))
        RETURN
          [n IN nodes(p) | { id: n.id, label: n.label, type: labels(n)[0] }] AS nodes,
          [r IN relationships(p) | {
            from: startNode(r).id, to: endNode(r).id,
            type: type(r), label: r.label, solid: r.solid
          }] AS edges,
          length(p) AS len
        `,
        { fromId: params.fromId, toId: params.toId },
      );

      if (result.records.length === 0) {
        logger.info('[kg] kg_path not found', { from: params.fromId, to: params.toId });
        return { found: false, length: 0, nodes: [], edges: [] };
      }
      const rec = result.records[0]!;
      const out: Result = {
        found: true,
        length: Number(rec.get('len')),
        nodes: rec.get('nodes'),
        edges: rec.get('edges'),
      };
      logger.info('[kg] kg_path', { from: params.fromId, to: params.toId, len: out.length });
      return out;
    });
  },
};