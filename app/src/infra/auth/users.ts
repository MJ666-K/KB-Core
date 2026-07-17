import { eq, ne, and, isNull, asc } from 'drizzle-orm';
import { db } from '@core/db/client';
import { users } from '@core/db/schema';
import { hashPassword } from './password';
import { roleExists, countUsersWithRole } from './role-service';
import { SUPERADMIN_ROLE_KEY } from './permission-registry';

export interface UserListItem {
  id: string;
  username: string;
  role: string;
  roleLabel?: string;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

function toListItem(row: typeof users.$inferSelect): UserListItem {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    disabled: row.disabled !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listUsers(): Promise<UserListItem[]> {
  const rows = await db.select().from(users).orderBy(asc(users.createdAt));
  return rows.map(toListItem);
}

export async function createUser(input: {
  username: string;
  password: string;
  role: string;
}): Promise<UserListItem> {
  if (!await roleExists(input.role)) {
    throw new Error('角色不存在');
  }
  const passwordHash = await hashPassword(input.password);
  const [row] = await db.insert(users).values({
    username: input.username,
    passwordHash,
    role: input.role,
  }).returning();
  return toListItem(row!);
}

export async function updateUser(
  id: string,
  input: {
    role?: string;
    password?: string;
    disabled?: boolean;
  },
): Promise<UserListItem | null> {
  if (input.role !== undefined && !await roleExists(input.role)) {
    throw new Error('角色不存在');
  }
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (input.role !== undefined) patch.role = input.role;
  if (input.password) patch.passwordHash = await hashPassword(input.password);
  if (input.disabled !== undefined) patch.disabled = input.disabled ? new Date() : null;

  const [row] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
  return row ? toListItem(row) : null;
}

export async function deleteUser(id: string): Promise<boolean> {
  const deleted = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  return deleted.length > 0;
}

export async function countSuperadmins(excludeId?: string): Promise<number> {
  return countUsersWithRole(SUPERADMIN_ROLE_KEY, excludeId);
}

export async function getUserById(id: string): Promise<UserListItem | null> {
  const row = await db.query.users.findFirst({ where: eq(users.id, id) });
  return row ? toListItem(row) : null;
}

export function canAssignRole(actorPermissions: string[], targetRoleKey: string, privilegedRoles: string[]): boolean {
  if (actorPermissions.includes('roles:manage')) return true;
  if (!actorPermissions.includes('users:manage')) return false;
  if (targetRoleKey === SUPERADMIN_ROLE_KEY) return false;
  return !privilegedRoles.includes(targetRoleKey);
}

export async function getPrivilegedRoleKeys(): Promise<string[]> {
  const rows = await db.select({ role: users.role }).from(users)
    .where(and(eq(users.role, SUPERADMIN_ROLE_KEY), isNull(users.disabled)));
  void rows;
  return [SUPERADMIN_ROLE_KEY];
}
