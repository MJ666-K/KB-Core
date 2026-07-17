import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '@infra/auth/middleware';
import { requireAnyPermission, requirePermission } from '@infra/auth/middleware';
import { db } from '@core/db/client';
import { datasets } from '@core/db/schema';

const app = new Hono<AuthEnv>();

const canListDatasets = requireAnyPermission(
  'documents:read', 'documents:write', 'agents:manage', 'settings:manage',
);

const schema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9\u4e00-\u9fff_-]+$/),
});

app.get('/', canListDatasets, async (c) => {
  const rows = await db.select().from(datasets);
  return c.json({ datasets: rows });
});

app.post('/', requirePermission('settings:manage'), async (c) => {
  const body = await c.req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', detail: parsed.error.issues }, 400);

  try {
    const [row] = await db.insert(datasets).values(parsed.data).returning();
    return c.json({ dataset: row }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return c.json({ error: 'Dataset name already exists' }, 409);
    }
    throw err;
  }
});

export default app;
