import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../auth/middleware';
import { requireAnyPermission, requirePermission } from '../auth/middleware';
import { db } from '../db/client';
import { models } from '../db/schema';
import { eq } from 'drizzle-orm';

const app = new Hono<AuthEnv>();

const canReadModels = requireAnyPermission('models:manage', 'agents:manage');
const canManageModels = requirePermission('models:manage');

const modelSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/),
  displayName: z.string().min(1).max(100),
  provider: z.string().min(1).max(50),
  modelId: z.string().min(1),
  apiUrl: z.string().url().nullable().optional(),
  apiKey: z.string().nullable().optional(),
  enabled: z.boolean().optional().default(true),
  temperature: z.number().min(0).max(2).optional().default(0.2),
  maxTokens: z.number().int().positive().optional().default(2048),
  topK: z.number().int().min(0).nullable().optional().default(0),
  topP: z.number().min(0).max(1).nullable().optional().default(0.9),
  frequencyPenalty: z.number().min(-2).max(2).nullable().optional().default(0),
  presencePenalty: z.number().min(-2).max(2).nullable().optional().default(0),
});

app.get('/', canReadModels, async (c) => {
  const onlyEnabled = c.req.query('enabled') === 'true';
  const query = onlyEnabled
    ? db.select().from(models).where(eq(models.enabled, true))
    : db.select().from(models);
  const rows = await query;
  return c.json({ models: rows });
});

app.get('/:key', canReadModels, async (c) => {
  const keyParam = c.req.param('key');
  if (!keyParam) return c.json({ error: 'Invalid key' }, 400);
  const key: string = keyParam;
  let row = await db.select().from(models).where(eq(models.name, key)).limit(1);
  if (row.length === 0) {
    row = await db.select().from(models).where(eq(models.id, key)).limit(1);
  }
  if (row.length === 0) return c.json({ error: 'Model not found' }, 404);
  return c.json({ model: row[0] });
});

app.post('/', canManageModels, async (c) => {
  const body = await c.req.json();
  const parsed = modelSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', detail: parsed.error.issues }, 400);

  try {
    const [row] = await db.insert(models).values(parsed.data).returning();
    return c.json({ model: row }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return c.json({ error: 'Model name already exists' }, 409);
    }
    throw err;
  }
});

app.put('/:key', canManageModels, async (c) => {
  const keyParam = c.req.param('key');
  if (!keyParam) return c.json({ error: 'Invalid key' }, 400);
  const key: string = keyParam;
  const body = await c.req.json();
  const parsed = modelSchema.partial().safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', detail: parsed.error.issues }, 400);

  const updated = await db.update(models)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(models.name, key))
    .returning();

  if (updated.length === 0) return c.json({ error: 'Model not found' }, 404);
  return c.json({ model: updated[0] });
});

app.delete('/:key', canManageModels, async (c) => {
  const keyParam = c.req.param('key');
  if (!keyParam) return c.json({ error: 'Invalid key' }, 400);
  const key: string = keyParam;
  const deleted = await db.delete(models).where(eq(models.name, key)).returning({ id: models.id });
  if (deleted.length === 0) return c.json({ error: 'Model not found' }, 404);
  return c.json({ ok: true });
});

export default app;
