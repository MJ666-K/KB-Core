/**
 * kg_* Tool 统一注册入口
 */
import type { Tool } from '@features/kb/tools/types';
import { kgSearchNodesTool } from './kg_search_nodes';
import { kgGetNodeTool } from './kg_get_node';
import { kgNeighborsTool } from './kg_neighbors';
import { kgPathTool } from './kg_path';
import { kgSubgraphTool } from './kg_subgraph';
import { kgToChunkTool } from './kg_to_chunk';

export const KG_TOOLS: Tool[] = [
  kgSearchNodesTool as unknown as Tool,
  kgGetNodeTool as unknown as Tool,
  kgNeighborsTool as unknown as Tool,
  kgPathTool as unknown as Tool,
  kgSubgraphTool as unknown as Tool,
  kgToChunkTool as unknown as Tool,
];

export function registerKgTools(registry: { register: (t: Tool) => void }): void {
  for (const tool of KG_TOOLS) registry.register(tool);
}

export {
  kgSearchNodesTool,
  kgGetNodeTool,
  kgNeighborsTool,
  kgPathTool,
  kgSubgraphTool,
  kgToChunkTool,
};