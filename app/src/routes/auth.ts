import { Hono } from 'hono';
import { z } from 'zod';
import { login, refreshSession, logout } from '../auth/service';
import type { AuthEnv } from '../auth/middleware';
import { authMiddleware, getAuthUser } from '../auth/middleware';
import { PERMISSION_GROUPS, PERMISSION_LABELS, PERMISSION_DESCRIPTIONS, ALL_PERMISSIONS } from '../auth/permission-registry';

const app = new Hono<AuthEnv>();

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

app.post('/login', async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', detail: parsed.error.issues }, 400);
  }

  const result = await login(parsed.data.username, parsed.data.password);
  if (!result) {
    return c.json({ error: '用户名或密码错误' }, 401);
  }
  return c.json(result);
});

app.post('/refresh', async (c) => {
  const parsed = refreshSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', detail: parsed.error.issues }, 400);
  }

  const result = await refreshSession(parsed.data.refreshToken);
  if (!result) {
    return c.json({ error: '登录已过期，请重新登录' }, 401);
  }
  return c.json(result);
});

app.post('/logout', async (c) => {
  const parsed = refreshSchema.safeParse(await c.req.json());
  if (parsed.success) {
    await logout(parsed.data.refreshToken);
  }
  return c.json({ ok: true });
});

app.use('/*', authMiddleware);

app.get('/me', async (c) => {
  const user = getAuthUser(c);
  return c.json({
    user,
    permissionMeta: {
      all: ALL_PERMISSIONS.map(p => ({
        key: p,
        label: PERMISSION_LABELS[p],
        description: PERMISSION_DESCRIPTIONS[p],
      })),
      groups: PERMISSION_GROUPS.map(g => ({
        key: g.key,
        title: g.title,
        permissions: g.permissions.map(p => ({
          key: p,
          label: PERMISSION_LABELS[p],
          description: PERMISSION_DESCRIPTIONS[p],
        })),
      })),
    },
  });
});

export default app;
