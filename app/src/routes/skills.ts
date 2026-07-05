import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { skillDefinitions } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { createSkillRegistry } from '../skills';

const app = new Hono();

const schema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/),
  displayName: z.string().min(1).max(100),
  description: z.string().min(1),
  tools: z.array(z.string()).optional().default([]),
  parameters: z.record(z.string(), z.unknown()).optional().default({}),
  instructions: z.string().min(1),
  enabled: z.boolean().optional().default(true),
});

app.get('/', async (c) => {
  const rows = await db.select({
    id: skillDefinitions.id,
    name: skillDefinitions.name,
    displayName: skillDefinitions.displayName,
    description: skillDefinitions.description,
    tools: skillDefinitions.tools,
    instructions: skillDefinitions.instructions,
    enabled: skillDefinitions.enabled,
    version: skillDefinitions.version,
    updatedAt: skillDefinitions.updatedAt,
  }).from(skillDefinitions);
  return c.json({ skills: rows });
});

app.get('/:key', async (c) => {
  const key = c.req.param('key');
  const rows = await db.select().from(skillDefinitions).where(eq(skillDefinitions.name, key));
  if (rows.length === 0) return c.json({ error: 'Skill not found' }, 404);
  return c.json({ skill: rows[0] });
});

app.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', detail: parsed.error.issues }, 400);

  try {
    const [row] = await db.insert(skillDefinitions).values({
      ...parsed.data,
      parameters: parsed.data.parameters as Record<string, unknown>,
    }).returning();
    return c.json({ skill: row }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return c.json({ error: 'Skill name already exists' }, 409);
    }
    throw err;
  }
});

app.put('/:key', async (c) => {
  const key = c.req.param('key');
  const body = await c.req.json();
  const parsed = schema.partial().safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', detail: parsed.error.issues }, 400);

  const existing = await db.select().from(skillDefinitions).where(eq(skillDefinitions.name, key));
  if (existing.length === 0) return c.json({ error: 'Skill not found' }, 404);

  const newVersion = (existing[0]!.version ?? 0) + 1;
  const [updated] = await db.update(skillDefinitions)
    .set({ ...parsed.data, version: newVersion, updatedAt: new Date() })
    .where(eq(skillDefinitions.name, key))
    .returning();
  return c.json({ skill: updated });
});

app.delete('/:key', async (c) => {
  const key = c.req.param('key');
  const [updated] = await db.update(skillDefinitions)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(skillDefinitions.name, key))
    .returning({ id: skillDefinitions.id });
  if (!updated) return c.json({ error: 'Skill not found' }, 404);
  return c.json({ ok: true });
});

export default app;
