import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../auth/middleware';
import { requirePermission } from '../auth/middleware';
import { db } from '../db/client';
import { agents, models } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getSubAgentRegistry } from '../agent/sub-agent-registry';

const app = new Hono<AuthEnv>();
app.use('*', requirePermission('agents:manage'));

const agentSchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/),
  displayName: z.string().min(1).max(100),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  modelId: z.string().uuid(),
  datasetIds: z.array(z.string().uuid()),
  skillNames: z.array(z.string()).optional().default([]),
  personality: z.string().nullable().optional(),
  enabled: z.boolean().optional().default(true),
});

app.get('/', async (c) => {
  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      displayName: agents.displayName,
      description: agents.description,
      modelId: agents.modelId,
      model: {
        name: models.name,
        displayName: models.displayName,
        provider: models.provider,
        modelId: models.modelId,
      },
      datasetIds: agents.datasetIds,
      skillNames: agents.skillNames,
      enabled: agents.enabled,
    })
    .from(agents)
    .innerJoin(models, eq(agents.modelId, models.id));
  return c.json({ agents: rows });
});

app.get('/:key', async (c) => {
  const key = c.req.param('key');
  const row = await db
    .select({
      id: agents.id,
      name: agents.name,
      displayName: agents.displayName,
      description: agents.description,
      modelId: agents.modelId,
      model: models,
      datasetIds: agents.datasetIds,
      skillNames: agents.skillNames,
      personality: agents.personality,
      enabled: agents.enabled,
    })
    .from(agents)
    .innerJoin(models, eq(agents.modelId, models.id))
    .where(eq(agents.name, key))
    .limit(1);
  if (row.length === 0) {
    const byId = await db
      .select({
        id: agents.id,
        name: agents.name,
        displayName: agents.displayName,
        description: agents.description,
        modelId: agents.modelId,
        model: models,
        datasetIds: agents.datasetIds,
        skillNames: agents.skillNames,
        personality: agents.personality,
        enabled: agents.enabled,
      })
      .from(agents)
      .innerJoin(models, eq(agents.modelId, models.id))
      .where(eq(agents.id, key))
      .limit(1);
    if (byId.length === 0) return c.json({ error: 'Agent not found' }, 404);
    return c.json({ agent: byId[0] });
  }
  return c.json({ agent: row[0] });
});

app.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = agentSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', detail: parsed.error.issues }, 400);

  try {
    const [row] = await db.insert(agents).values(parsed.data).returning();
    await getSubAgentRegistry().reload();
    return c.json({ agent: row }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return c.json({ error: 'Agent name already exists' }, 409);
    }
    throw err;
  }
});

app.put('/:key', async (c) => {
  const key = c.req.param('key');
  const body = await c.req.json();
  const parsed = agentSchema.partial().safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', detail: parsed.error.issues }, 400);

  const updated = await db.update(agents)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(agents.name, key))
    .returning();

  if (updated.length === 0) return c.json({ error: 'Agent not found' }, 404);
  await getSubAgentRegistry().reload();
  return c.json({ agent: updated[0] });
});

app.delete('/:key', async (c) => {
  const key = c.req.param('key');
  const enabledCount = await db.select({ c: agents.id }).from(agents).where(eq(agents.enabled, true));
  if (enabledCount.length <= 1) {
    return c.json({ error: 'Cannot delete the last enabled agent' }, 400);
  }

  const deleted = await db.delete(agents).where(eq(agents.name, key)).returning({ id: agents.id });
  if (deleted.length === 0) return c.json({ error: 'Agent not found' }, 404);
  await getSubAgentRegistry().reload();
  return c.json({ ok: true });
});

export default app;
