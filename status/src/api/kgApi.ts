/**
 * 知识图谱后端 API 封装
 */
import { authFetch } from '../auth/AuthContext';

const headers = { 'Content-Type': 'application/json' };

export type KgNodeType = 'Flow' | 'Law' | 'Evidence' | 'Case';

export interface KgNode {
  id: string;
  label: string;
  category: string;
  type: KgNodeType;
  chunkId: string | null;
  stepOrder: number | null;
  meta: Record<string, unknown>;
}

export interface KgEdge {
  from: string;
  to: string;
  type: string;
  solid: boolean;
  label: string | null;
}

export interface KgSubgraph {
  nodes: KgNode[];
  edges: KgEdge[];
}

export const kgApi = {
  search: (params: { keyword: string; type?: KgNodeType; category?: string; limit?: number }) =>
    authFetch('/api/kg/search', { method: 'POST', headers, body: JSON.stringify(params) })
      .then(r => r.json() as Promise<{ nodes: KgNode[] }>),

  getNode: (id: string) =>
    authFetch(`/api/kg/nodes/${encodeURIComponent(id)}`)
      .then(r => r.json() as Promise<{ node: KgNode | null; incoming: KgEdge[]; outgoing: KgEdge[] }>),

  getNeighbors: (id: string, params: { edgeType?: string; direction?: 'out' | 'in' | 'both'; solid?: boolean; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.edgeType) qs.set('edgeType', params.edgeType);
    if (params.direction) qs.set('direction', params.direction);
    if (params.solid !== undefined) qs.set('solid', String(params.solid));
    if (params.limit) qs.set('limit', String(params.limit));
    return authFetch(`/api/kg/nodes/${encodeURIComponent(id)}/neighbors?${qs.toString()}`)
      .then(r => r.json() as Promise<KgSubgraph>);
  },

  getChunk: (id: string) =>
    authFetch(`/api/kg/nodes/${encodeURIComponent(id)}/chunk`)
      .then(r => r.json() as Promise<{
        nodeId: string; nodeLabel: string | null; chunkId: string | null;
        docId: string | null; docTitle: string | null; text: string | null;
      }>),

  path: (fromId: string, toId: string, maxDepth = 5) =>
    authFetch('/api/kg/path', {
      method: 'POST', headers,
      body: JSON.stringify({ fromId, toId, maxDepth }),
    }).then(r => r.json() as Promise<{
      found: boolean; length: number;
      nodes: Array<{ id: string; label: string; type: string }>;
      edges: Array<{ from: string; to: string; type: string; label: string | null; solid: boolean }>;
    }>),

  subgraph: (rootIds: string[], depth = 2, category?: string, full?: boolean) =>
    authFetch('/api/kg/subgraph', {
      method: 'POST', headers,
      body: JSON.stringify({ rootIds, depth, category, full }),
    }).then(r => r.json() as Promise<KgSubgraph>),

  stats: () =>
    authFetch('/api/kg/stats').then(r => r.json() as Promise<{
      total: number;
      byType: Array<{ type: string; category: string | null; count: number }>;
    }>),

  ingest: (body: { data?: unknown; filePath?: string } = {}) =>
    authFetch('/api/kg/ingest', { method: 'POST', headers, body: JSON.stringify(body) })
      .then(r => r.json() as Promise<{ ok: boolean; source?: string; error?: string; detail?: string }>),
};