import { eq, or, and } from 'drizzle-orm';
import { db } from '../db/client';
import { datasets, datasetMembers } from '../db/schema';
import { SUPERADMIN_ROLE_KEY } from './permission-registry';

export type DatasetAccess = 'none' | 'read' | 'write' | 'manage';
export type AgentAccess = 'none' | 'read' | 'manage';

export type DatasetVisibility = 'private' | 'shared' | 'public';
export type AgentVisibility = 'private' | 'shared' | 'public';

export interface DatasetAccessRow {
  id: string;
  ownerId: string;
  visibility: DatasetVisibility;
}

export interface AgentAccessRow {
  ownerId: string;
  visibility: AgentVisibility;
}

/** 是否超管（按角色 key 判断） */
export function isSuperadminUser(role: string): boolean {
  return role === SUPERADMIN_ROLE_KEY;
}

/**
 * 库行级访问判定（RBAC 行级所有权 + shared 库 ACL）。
 * 返回 none/read/write/manage。
 *   - superadmin → manage
 *   - owner → manage
 *   - public → read
 *   - shared → 查 dataset_members，viewer→read / editor→write / manager→manage
 *   - private 非 owner → none
 */
export async function resolveDatasetAccess(
  dataset: DatasetAccessRow,
  userId: string,
  isSuperadmin: boolean,
): Promise<DatasetAccess> {
  if (isSuperadmin) return 'manage';
  if (dataset.ownerId === userId) return 'manage';
  if (dataset.visibility === 'public') return 'read';
  if (dataset.visibility === 'shared') {
    const m = await db.query.datasetMembers.findFirst({
      where: and(
        eq(datasetMembers.datasetId, dataset.id),
        eq(datasetMembers.userId, userId),
      ),
    });
    if (!m) return 'none';
    if (m.role === 'viewer') return 'read';
    if (m.role === 'editor') return 'write';
    return 'manage'; // manager
  }
  return 'none'; // private 非 owner
}

/**
 * 智能体行级访问判定（当前仅启用 private/public 两级，shared 预留二期）。
 *   - superadmin → manage
 *   - owner → manage
 *   - public → read
 *   - private 非 owner → none
 */
export function resolveAgentAccess(
  agent: AgentAccessRow,
  userId: string,
  isSuperadmin: boolean,
): AgentAccess {
  if (isSuperadmin) return 'manage';
  if (agent.ownerId === userId) return 'manage';
  if (agent.visibility === 'public') return 'read';
  return 'none';
}

/** 用户对智能体是否可见（read 或 manage） */
export function agentVisibleToUser(
  agent: AgentAccessRow,
  userId: string,
  isSuperadmin: boolean,
): boolean {
  return resolveAgentAccess(agent, userId, isSuperadmin) !== 'none';
}

/**
 * 用户可访问（read 及以上）的所有 datasetId 集合——用于文档列表按权限过滤。
 * superadmin 返回全部；否则 = owner 自己的 + public 的 + shared 中自己是 member 的。
 */
export async function accessibleDatasetIds(userId: string, isSuperadmin: boolean): Promise<string[]> {
  if (isSuperadmin) {
    const all = await db.select({ id: datasets.id }).from(datasets);
    return all.map(r => r.id);
  }
  const ownOrPublic = await db.select({ id: datasets.id }).from(datasets)
    .where(or(eq(datasets.ownerId, userId), eq(datasets.visibility, 'public')));
  const memberRows = await db.select({ datasetId: datasetMembers.datasetId })
    .from(datasetMembers).where(eq(datasetMembers.userId, userId));
  const ids = new Set<string>(ownOrPublic.map(r => r.id));
  for (const r of memberRows) {
    if (r && r.datasetId) ids.add(r.datasetId);
  }
  return [...ids];
}

/** 访问级别是否满足所需操作 */
export function hasAccessLevel(actual: DatasetAccess | AgentAccess, required: DatasetAccess | AgentAccess): boolean {
  const order: Record<string, number> = { none: 0, read: 1, write: 2, manage: 3 };
  return (order[actual] ?? 0) >= (order[required] ?? 0);
}
