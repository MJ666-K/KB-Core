/**
 * 知识图谱专用 Hooks
 *
 * - kg:trace  记录 kg_* Tool 调用（节点数、边数、耗时）
 * - kg:access 阻断无权限 datasetId 的访问（多租户隔离）
 */
import { db } from '../db/client';
import { queryLogs } from '../db/schema';
import { logger } from '../utils/logger';
import type { Hook } from './types';

const KG_TOOL_NAMES = [
  'kg_search_nodes',
  'kg_get_node',
  'kg_neighbors',
  'kg_path',
  'kg_subgraph',
  'kg_to_chunk',
];

/**
 * 记录 kg_* Tool 调用的输入输出 + 耗时
 */
export const kgTraceHook: Hook = {
  name: 'kg:trace',
  target: 'tool',
  phase: 'after',
  filter: KG_TOOL_NAMES,
  async after(ctx, result) {
    const r = result as { nodes?: unknown[]; edges?: unknown[] } | null;
    const nodeCount = Array.isArray(r?.nodes) ? r!.nodes!.length : 0;
    const edgeCount = Array.isArray(r?.edges) ? r!.edges!.length : 0;
    logger.info('[kg] trace', {
      tool: ctx.targetName,
      datasetId: ctx.metadata.datasetId,
      userId: ctx.metadata.userId,
      queryLogId: ctx.metadata.queryLogId,
      nodeCount,
      edgeCount,
      latencyMs: Date.now() - ctx.metadata.timestamp,
    });
    // 写 query_logs（kg 工具独立于 retrieval，所以只记日志，不走 audit hook）
    try {
      await db.insert(queryLogs).values({
        query: `[kg] ${ctx.targetName}`,
        datasetId: ctx.metadata.datasetId,
        answer: null,
        citations: [],
        toolCalls: [{
          name: ctx.targetName,
          kind: 'tool' as const,
          params: (ctx.params ?? {}) as Record<string, unknown>,
          result: { nodeCount, edgeCount },
          latencyMs: Date.now() - ctx.metadata.timestamp,
        }],
        latencyMs: Date.now() - ctx.metadata.timestamp,
      });
    } catch (e) {
      logger.warn('[kg] trace insert failed', { err: (e as Error).message });
    }
    return undefined;
  },
};

/**
 * 多租户隔离：datasetId 不在用户授权列表里时阻断
 * 注：当前 ctx.metadata.datasetId 是"当前 query 的 datasetId"，更严格的方案是把所有允许的 datasetIds 注入到 ctx。
 * 简化方案：kg 工具内部本来就不带 datasetId 过滤（整图共享），此 Hook 仅做"占位"，等真正接入多租户时再扩展。
 */
export const kgAccessHook: Hook = {
  name: 'kg:access',
  target: 'tool',
  phase: 'before',
  filter: KG_TOOL_NAMES,
  async before(ctx) {
    if (!ctx.metadata.datasetId) {
      logger.debug('[kg] access: no datasetId in ctx, allow (legacy)');
      return;
    }
    // 简化：当前 datasetId 即可访问全图谱；后续接 RBAC 时按 user.datasetIds 过滤
    return;
  },
};