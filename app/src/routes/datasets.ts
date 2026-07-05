import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { datasets } from '../db/schema';

const app = new Hono();

const schema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9\u4e00-\u9fff_-]+$/),
});

app.get('/', async (c) => {
  const rows = await db.select().from(datasets);
  return c.json({ datasets: rows });
});

app.post('/', async (c) => {
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
