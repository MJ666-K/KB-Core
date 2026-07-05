import { eq, and, ne, isNull, asc, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { roles, rolePermissions, users } from '../db/schema';
import {
  ALL_PERMISSIONS,
  isPermission,
  SUPERADMIN_ROLE_KEY,
  type Permission,
} from './permission-registry';

export interface RoleRecord {
  id: string;
  key: string;
  label: string;
  description: string;
  isSystem: boolean;
  permissions: Permission[];
  userCount?: number;
  createdAt: string;
  updatedAt: string;
}

let permCache: Map<string, Permission[]> | null = null;
let roleLabelCache: Map<string, string> | null = null;
let cacheAt = 0;
const CACHE_TTL_MS = 15_000;

function invalidateCache(): void {
  permCache = null;
  roleLabelCache = null;
  cacheAt = 0;
}

async function loadCache(): Promise<void> {
  if (permCache && Date.now() - cacheAt < CACHE_TTL_MS) return;

  const rows = await db.select({
    key: roles.key,
    label: roles.label,
    permission: rolePermissions.permission,
  })
    .from(roles)
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id));

  const perms = new Map<string, Permission[]>();
  const labels = new Map<string, string>();

  for (const row of rows) {
    labels.set(row.key, row.label);
    if (!row.permission || !isPermission(row.permission)) continue;
    const list = perms.get(row.key) ?? [];
    if (!list.includes(row.permission)) list.push(row.permission);
    perms.set(row.key, list);
  }

  permCache = perms;
  roleLabelCache = labels;
  cacheAt = Date.now();
}

export async function getPermissionsForRole(roleKey: string): Promise<Permission[]> {
  if (roleKey === SUPERADMIN_ROLE_KEY) return [...ALL_PERMISSIONS];
  await loadCache();
  return permCache?.get(roleKey) ?? [];
}

export async function getRoleLabel(roleKey: string): Promise<string> {
  await loadCache();
  return roleLabelCache?.get(roleKey) ?? roleKey;
}

export async function resolveUserAuth(roleKey: string): Promise<{ roleLabel: string; permissions: Permission[] }> {
  const [roleLabel, permissions] = await Promise.all([
    getRoleLabel(roleKey),
    getPermissionsForRole(roleKey),
  ]);
  return { roleLabel, permissions };
}

async function fetchUserCounts(): Promise<Map<string, number>> {
  const rows = await db.select({
    role: users.role,
    count: sql<number>`COUNT(*)::int`,
  }).from(users).where(isNull(users.disabled)).groupBy(users.role);
  return new Map(rows.map(r => [r.role, r.count]));
}

export async function listRoles(): Promise<RoleRecord[]> {
  const [roleRows, permRows, countMap] = await Promise.all([
    db.select().from(roles).orderBy(asc(roles.isSystem), asc(roles.createdAt)),
    db.select().from(rolePermissions),
    fetchUserCounts(),
  ]);

  const permMap = new Map<string, Permission[]>();
  for (const p of permRows) {
    if (!isPermission(p.permission)) continue;
    const list = permMap.get(p.roleId) ?? [];
    list.push(p.permission);
    permMap.set(p.roleId, list);
  }

  return roleRows.map(r => ({
    id: r.id,
    key: r.key,
    label: r.label,
    description: r.description,
    isSystem: r.isSystem,
    permissions: permMap.get(r.id) ?? [],
    userCount: countMap.get(r.key) ?? 0,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function getRoleByKey(key: string): Promise<RoleRecord | null> {
  const row = await db.query.roles.findFirst({ where: eq(roles.key, key) });
  if (!row) return null;
  const perms = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, row.id));
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    isSystem: row.isSystem,
    permissions: perms.map(p => p.permission).filter(isPermission),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createRole(input: {
  key: string;
  label: string;
  description?: string;
  permissions: Permission[];
}): Promise<RoleRecord> {
  const [row] = await db.insert(roles).values({
    key: input.key,
    label: input.label,
    description: input.description ?? '',
    isSystem: false,
  }).returning();

  if (input.permissions.length > 0) {
    await db.insert(rolePermissions).values(
      input.permissions.map(p => ({ roleId: row!.id, permission: p })),
    );
  }

  invalidateCache();
  const created = await getRoleByKey(row!.key);
  return created!;
}

export async function updateRole(
  id: string,
  input: {
    label?: string;
    description?: string;
    permissions?: Permission[];
  },
): Promise<RoleRecord | null> {
  const existing = await db.query.roles.findFirst({ where: eq(roles.id, id) });
  if (!existing) return null;

  if (input.label !== undefined || input.description !== undefined) {
    await db.update(roles).set({
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      updatedAt: new Date(),
    }).where(eq(roles.id, id));
  }

  if (input.permissions !== undefined) {
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
    if (input.permissions.length > 0) {
      await db.insert(rolePermissions).values(
        input.permissions.map(p => ({ roleId: id, permission: p })),
      );
    }
  }

  invalidateCache();
  return getRoleByKey(existing.key);
}

export async function deleteRole(id: string): Promise<{ ok: boolean; error?: string }> {
  const existing = await db.query.roles.findFirst({ where: eq(roles.id, id) });
  if (!existing) return { ok: false, error: '角色不存在' };
  if (existing.isSystem) return { ok: false, error: '系统内置角色不可删除' };
  if (existing.key === SUPERADMIN_ROLE_KEY) return { ok: false, error: '不能删除超级管理员角色' };

  const used = await db.select({ id: users.id }).from(users)
    .where(eq(users.role, existing.key))
    .limit(1);
  if (used.length > 0) return { ok: false, error: '仍有用户使用该角色，请先变更用户角色' };

  await db.delete(roles).where(eq(roles.id, id));
  invalidateCache();
  return { ok: true };
}

export async function countUsersWithRole(roleKey: string, excludeUserId?: string): Promise<number> {
  const conditions = [eq(users.role, roleKey), isNull(users.disabled)];
  if (excludeUserId) conditions.push(ne(users.id, excludeUserId));
  const rows = await db.select({ c: sql<number>`COUNT(*)::int` }).from(users).where(and(...conditions));
  return rows[0]?.c ?? 0;
}

export async function roleExists(roleKey: string): Promise<boolean> {
  const row = await db.query.roles.findFirst({ where: eq(roles.key, roleKey) });
  return !!row;
}

export async function seedDefaultRoles(): Promise<void> {
  const sa = await db.query.roles.findFirst({ where: eq(roles.key, SUPERADMIN_ROLE_KEY) });
  if (!sa) {
    const created = await createRole({
      key: SUPERADMIN_ROLE_KEY,
      label: '超级管理员',
      description: '拥有系统全部权限',
      permissions: [...ALL_PERMISSIONS],
    });
    await db.update(roles).set({ isSystem: true }).where(eq(roles.id, created.id));
  }
  invalidateCache();
}

export async function listAssignableRoles(actorPermissions: Permission[]): Promise<RoleRecord[]> {
  const all = await listRoles();
  if (!actorPermissions.includes('users:manage')) return [];
  if (actorPermissions.includes('roles:manage')) return all;
  return all.filter(r =>
    !r.permissions.includes('users:manage') &&
    !r.permissions.includes('roles:manage') &&
    r.key !== SUPERADMIN_ROLE_KEY,
  );
}

export function invalidateRoleCache(): void {
  invalidateCache();
}
