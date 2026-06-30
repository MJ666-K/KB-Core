import { Hono } from 'hono';
import { db } from '../db/client';
import { documents, ingestJobs, chunks } from '../db/schema';
import { eq, isNull, desc, and } from 'drizzle-orm';

const app = new Hono();

app.get('/documents/:id', async (c) => {
  const id = c.req.param('id');
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, id) });
  if (!doc || doc.deletedAt) return c.json({ error: 'Not found' }, 404);
  return c.json(doc);
});

app.get('/documents/:id/jobs', async (c) => {
  const id = c.req.param('id');
  const jobs = await db.select().from(ingestJobs).where(eq(ingestJobs.documentId, id));
  return c.json(jobs);
});

app.get('/documents', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 100);
  const datasetId = c.req.query('datasetId');
  const conditions = [isNull(documents.deletedAt)];
  if (datasetId) {
    conditions.push(eq(documents.datasetId, datasetId));
  }
  const docs = await db.query.documents.findMany({
    where: conditions.length === 1 ? conditions[0]! : and(...conditions),
    limit,
  });
  return c.json({ documents: docs });
});

app.delete('/documents/:id', async (c) => {
  const id = c.req.param('id');
  await db.update(documents).set({ deletedAt: new Date(), status: 'failed', updatedAt: new Date() }).where(eq(documents.id, id));
  await db.delete(chunks).where(eq(chunks.documentId, id));
  return c.json({ ok: true, message: 'Document soft-deleted, chunks hard-deleted' });
});

export default app;
