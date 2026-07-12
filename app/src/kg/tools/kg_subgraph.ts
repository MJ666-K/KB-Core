import type { Tool } from '../../tools/types';
import { withSession, type KgSubgraph, cypherNodeProjection, nodeToPlain, edgeToPlain } from '../client';
import { logger } from '../../utils/logger';
import { config } from '../../config';

interface Params {
  rootIds: string[];
  depth?: number;
  category?: string;
  full?: boolean;
}

const NODE_MAP_IN_LIST = cypherNodeProjection('ni');

export const kgSubgraphTool: Tool<Params, KgSubgraph> = {
  name: 'kg_subgraph',
  description: '围绕一组根节点拉取指定跳数内的子图；full=true 时返回全库图谱。',
  parameters: {
    type: 'object',
    properties: {
      rootIds: { type: 'array', description: '根节点 id 列表（1-10 个）',
        items: { type: 'string', description: '节点 id' } },
      depth: { type: 'number', description: '拉取深度（1-3），默认 2', default: 2 },
      category: { type: 'string', description: '业务分类过滤' },
      full: { type: 'boolean', description: '为 true 时忽略 rootIds/depth，返回全部节点与边' },
    },
    required: ['rootIds'],
  },
  async execute(params: Params): Promise<KgSubgraph> {
    if (!config.kgEnabled) return { nodes: [], edges: [] };

    return await withSession(async (session) => {
      if (params.full) {
        const result = await session.run(`
          MATCH (n)
          WHERE any(l IN labels(n) WHERE l IN ['Flow', 'Law', 'Evidence', 'Case'])
          WITH collect(DISTINCT n) AS nodes
          UNWIND nodes AS n1
          UNWIND nodes AS n2
          MATCH (n1)-[r]-(n2)
          WITH nodes,
               collect(DISTINCT {
                 from: startNode(r).id, to: endNode(r).id,
                 type: type(r), solid: r.solid, label: r.label
               }) AS edges
          RETURN
            [ni IN nodes | ${NODE_MAP_IN_LIST}] AS nodes,
            edges
        `);
        if (result.records.length === 0) return { nodes: [], edges: [] };
        const rec = result.records[0]!;
        const out: KgSubgraph = {
          nodes: (rec.get('nodes') as unknown[]).map(n => nodeToPlain(n as Parameters<typeof nodeToPlain>[0])),
          edges: (rec.get('edges') as unknown[]).map(e => edgeToPlain(e as Parameters<typeof edgeToPlain>[0])),
        };
        logger.info('[kg] kg_subgraph full', { nodes: out.nodes.length, edges: out.edges.length });
        return out;
      }

      if (params.rootIds.length === 0) return { nodes: [], edges: [] };
      const depth = Math.min(Math.max(params.depth ?? 2, 1), 3);

      const result = await session.run(
        `
        MATCH (root)
        WHERE root.id IN $rootIds
          AND ($category IS NULL OR root.category = $category)
        MATCH p=(root)-[*1..${depth}]-(m)
        WITH collect(p) AS paths
        UNWIND paths AS p
        UNWIND nodes(p) AS n
        WITH collect(DISTINCT n) AS nodes
        UNWIND nodes AS n1
        UNWIND nodes AS n2
        MATCH (n1)-[r]-(n2)
        WITH nodes,
             collect(DISTINCT {
               from: startNode(r).id, to: endNode(r).id,
               type: type(r), solid: r.solid, label: r.label
             }) AS edges
        RETURN
          [ni IN nodes | ${NODE_MAP_IN_LIST}] AS nodes,
          edges
        `,
        {
          rootIds: params.rootIds,
          category: params.category ?? null,
        },
      );
      if (result.records.length === 0) return { nodes: [], edges: [] };
      const rec = result.records[0]!;
      const out: KgSubgraph = {
        nodes: (rec.get('nodes') as unknown[]).map(n => nodeToPlain(n as Parameters<typeof nodeToPlain>[0])),
        edges: (rec.get('edges') as unknown[]).map(e => edgeToPlain(e as Parameters<typeof edgeToPlain>[0])),
      };
      logger.info('[kg] kg_subgraph', { rootIds: params.rootIds, depth, nodes: out.nodes.length, edges: out.edges.length });
      return out;
    });
  },
};
