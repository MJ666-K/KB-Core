import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../auth/middleware';
import { getAuthUser, requirePermission } from '../auth/middleware';
import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  isPermission,
} from '../auth/permission-registry';
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  getRoleByKey,
} from '../auth/role-service';

const app = new Hono<AuthEnv>();

const createSchema = z.object({
  key: z.string().min(2).max(32).regex(/^[a-z][a-z0-9_]*$/, '以小写字母开头，仅含小写、数字、下划线'),
  label: z.string().min(1).max(64),
  description: z.string().max(256).optional(),
  permissions: z.array(z.string()).default([]),
});

const updateSchema = z.object({
  label: z.string().min(1).max(64).optional(),
  description: z.string().max(256).optional(),
  permissions: z.array(z.string()).optional(),
});

app.get('/meta', requirePermission('roles:manage'), (c) => {
  return c.json({
    permissions: ALL_PERMISSIONS.map(p => ({ key: p, label: PERMISSION_LABELS[p] })),
    groups: PERMISSION_GROUPS.map(g => ({
      title: g.title,
      permissions: g.permissions.map(p => ({ key: p, label: PERMISSION_LABELS[p] })),
    })),
  });
});

app.get('/', requirePermission('roles:manage'), async (c) => {
  const roles = await listRoles();
  return c.json({ roles });
});

app.post('/', requirePermission('roles:manage'), async (c) => {
  const parsed = createSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', detail: parsed.error.issues }, 400);
  }

  const perms = parsed.data.permissions.filter(isPermission);
  const existing = await getRoleByKey(parsed.data.key);
  if (existing) return c.json({ error: '角色标识已存在' }, 409);

  try {
    const role = await createRole({
      key: parsed.data.key,
      label: parsed.data.label,
      description: parsed.data.description,
      permissions: perms,
    });
    return c.json({ role }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return c.json({ error: '角色标识已存在' }, 409);
    }
    throw e;
  }
});

app.put('/:id', requirePermission('roles:manage'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Invalid id' }, 400);

  const parsed = updateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', detail: parsed.error.issues }, 400);
  }

  const perms = parsed.data.permissions?.filter(isPermission);
  const role = await updateRole(id, {
    label: parsed.data.label,
    description: parsed.data.description,
    permissions: perms,
  });
  if (!role) return c.json({ error: '角色不存在' }, 404);
  return c.json({ role });
});

app.delete('/:id', requirePermission('roles:manage'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Invalid id' }, 400);

  const result = await deleteRole(id);
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json({ ok: true });
});

export default app;
