import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '@infra/auth/middleware';
import { getAuthUser, requirePermission } from '@infra/auth/middleware';
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  countSuperadmins,
  getUserById,
} from '@infra/auth/users';
import { listAssignableRoles, getRoleLabel } from '@infra/auth/role-service';
import { SUPERADMIN_ROLE_KEY } from '@infra/auth/permission-registry';

const app = new Hono<AuthEnv>();

const createSchema = z.object({
  username: z.string().min(2).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(6).max(128),
  role: z.string().min(1).max(32),
});

const updateSchema = z.object({
  role: z.string().min(1).max(32).optional(),
  password: z.string().min(6).max(128).optional(),
  disabled: z.boolean().optional(),
}).refine(d => d.role !== undefined || d.password !== undefined || d.disabled !== undefined, {
  message: '至少提供一个更新字段',
});

async function enrichUsers(rows: Awaited<ReturnType<typeof listUsers>>) {
  return Promise.all(rows.map(async u => ({
    ...u,
    roleLabel: await getRoleLabel(u.role),
  })));
}

app.get('/assignable-roles', requirePermission('users:manage'), async (c) => {
  const actor = getAuthUser(c);
  const roles = await listAssignableRoles(actor.permissions);
  return c.json({ roles });
});

app.get('/', requirePermission('users:manage'), async (c) => {
  const users = await enrichUsers(await listUsers());
  return c.json({ users });
});

app.post('/', requirePermission('users:manage'), async (c) => {
  const actor = getAuthUser(c);
  const parsed = createSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', detail: parsed.error.issues }, 400);
  }

  const assignable = await listAssignableRoles(actor.permissions);
  if (!assignable.some(r => r.key === parsed.data.role)) {
    return c.json({ error: '无权分配该角色' }, 403);
  }

  try {
    const user = await createUser(parsed.data);
    return c.json({ user: { ...user, roleLabel: await getRoleLabel(user.role) } }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return c.json({ error: '用户名已存在' }, 409);
    }
    if (msg.includes('角色不存在')) return c.json({ error: msg }, 400);
    throw e;
  }
});

app.put('/:id', requirePermission('users:manage'), async (c) => {
  const actor = getAuthUser(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Invalid id' }, 400);

  const parsed = updateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', detail: parsed.error.issues }, 400);
  }

  const target = await getUserById(id);
  if (!target) return c.json({ error: '用户不存在' }, 404);

  if (actor.id === target.id && parsed.data.role !== undefined && parsed.data.role !== target.role) {
    return c.json({ error: '不能修改自己的角色' }, 403);
  }

  if (parsed.data.role !== undefined) {
    const assignable = await listAssignableRoles(actor.permissions);
    if (!assignable.some(r => r.key === parsed.data.role)) {
      return c.json({ error: '无权分配该角色' }, 403);
    }
  }

  if (parsed.data.disabled === true && target.role === SUPERADMIN_ROLE_KEY) {
    const remaining = await countSuperadmins(id);
    if (remaining === 0) return c.json({ error: '不能禁用最后一个超级管理员' }, 400);
  }

  if (parsed.data.role !== undefined && target.role === SUPERADMIN_ROLE_KEY && parsed.data.role !== SUPERADMIN_ROLE_KEY) {
    const remaining = await countSuperadmins(id);
    if (remaining === 0) return c.json({ error: '不能降级最后一个超级管理员' }, 400);
  }

  try {
    const user = await updateUser(id, parsed.data);
    return c.json({ user: user ? { ...user, roleLabel: await getRoleLabel(user.role) } : null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('角色不存在')) return c.json({ error: msg }, 400);
    throw e;
  }
});

app.delete('/:id', requirePermission('users:manage'), async (c) => {
  const actor = getAuthUser(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Invalid id' }, 400);

  if (actor.id === id) return c.json({ error: '不能删除自己的账号' }, 400);

  const target = await getUserById(id);
  if (!target) return c.json({ error: '用户不存在' }, 404);

  const assignable = await listAssignableRoles(actor.permissions);
  if (!assignable.some(r => r.key === target.role) && target.role !== actor.role) {
    return c.json({ error: '无权管理该用户' }, 403);
  }

  if (target.role === SUPERADMIN_ROLE_KEY) {
    const remaining = await countSuperadmins(id);
    if (remaining === 0) return c.json({ error: '不能删除最后一个超级管理员' }, 400);
  }

  await deleteUser(id);
  return c.json({ ok: true });
});

export default app;
