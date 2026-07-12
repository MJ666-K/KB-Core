import { Hono } from 'hono';
import type { AuthEnv } from '../auth/middleware';
import { requirePermission } from '../auth/middleware';
import { db } from '../db/client';
import { documents, chunks, datasets as datasetsSchema } from '../db/schema';
import { eq, and, isNull, desc, sql, inArray } from 'drizzle-orm';
import { readDocumentText } from '../storage/document-storage';
import { normalizeDocumentContent } from '../utils/text-normalize';
import { resetDocumentForReingest, enqueueIngest } from '../pipeline/document-reset';
import { logger } from '../utils/logger';

const app = new Hono<AuthEnv>();

app.get('/', requirePermission('documents:read'), async (c) => {
  const datasetId = c.req.query('datasetId');
  const status = c.req.query('status');
  const search = c.req.query('search');
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);

  let q = db.select({
    id: documents.id,
    title: documents.title,
    docType: documents.docType,
    status: documents.status,
    fileSize: documents.fileSize,
    createdAt: documents.createdAt,
    updatedAt: documents.updatedAt,
    datasetName: datasetsSchema.name,
  }).from(documents)
    .innerJoin(datasetsSchema, eq(documents.datasetId, datasetsSchema.id))
    .where(
      and(
        isNull(documents.deletedAt),
        datasetId ? eq(documents.datasetId, datasetId) : undefined,
        status ? sql`${documents.status} = ${status}` : undefined,
        search ? sql`LOWER(${documents.title}) LIKE LOWER(${`%${search}%`})` : undefined,
      )!,
    )
    .orderBy(desc(documents.createdAt))
    .limit(limit)
    .offset(offset);

  const rows = await q;
  // Enrich each row with chunk count
  const enriched = await Promise.all(rows.map(async (r) => {
    const chunkCount = await db.select({ c: sql<number>`COUNT(*)` }).from(chunks).where(eq(chunks.documentId, r.id));
    return { ...r, chunkCount: Number(chunkCount[0]?.c ?? 0) };
  }));

  return c.json({ documents: enriched });
});

app.get('/:id', requirePermission('documents:read'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const rows = await db.select({
    id: documents.id, title: documents.title, docType: documents.docType,
    status: documents.status, fileSize: documents.fileSize, fileHash: documents.fileHash,
    contentHash: documents.contentHash, createdAt: documents.createdAt, updatedAt: documents.updatedAt,
    datasetId: documents.datasetId, datasetName: datasetsSchema.name,
  }).from(documents)
    .innerJoin(datasetsSchema, eq(documents.datasetId, datasetsSchema.id))
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)));
  if (rows.length === 0) return c.json({ error: 'Document not found' }, 404);
  return c.json({ document: rows[0] });
});

app.get('/:id/content', requirePermission('documents:read'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const [doc] = await db.select({ sourcePath: documents.sourcePath, title: documents.title })
    .from(documents).where(eq(documents.id, id));
  if (!doc) return c.json({ error: 'Document not found' }, 404);
  try {
    const content = normalizeDocumentContent(await readDocumentText(doc.sourcePath));
    return c.text(content);
  } catch (err) {
    logger.error('[Documents] Failed to read content', { id, sourcePath: doc.sourcePath, err });
    return c.json({ error: 'File not found in storage' }, 404);
  }
});

app.get('/:id/chunks', requirePermission('documents:read'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const rows = await db.select({
    id: chunks.id,
    parentId: chunks.parentId,
    parentChunkIndex: chunks.parentChunkIndex,
    childIndexWithinParent: chunks.childIndexWithinParent,
    chunkIndex: chunks.chunkIndex,
    content: chunks.content,
    contentHash: chunks.contentHash,
    tokenCount: chunks.tokenCount,
    startOffset: chunks.startOffset,
    endOffset: chunks.endOffset,
    embeddingStatus: chunks.embeddingStatus,
    scope: chunks.scope,
    createdAt: chunks.createdAt,
  }).from(chunks).where(eq(chunks.documentId, id));
  return c.json({ chunks: rows });
});

app.delete('/:id', requirePermission('documents:write'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const [updated] = await db.update(documents)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(documents.id, id))
    .returning({ id: documents.id });
  if (!updated) return c.json({ error: 'Document not found' }, 404);
  await db.delete(chunks).where(eq(chunks.documentId, id));
  return c.json({ ok: true });
});

app.post('/:id/reingest', requirePermission('documents:write'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const [doc] = await db.select({ sourcePath: documents.sourcePath, datasetId: documents.datasetId })
    .from(documents).where(and(eq(documents.id, id), isNull(documents.deletedAt)));
  if (!doc) return c.json({ error: 'Document not found' }, 404);

  await resetDocumentForReingest(id);
  await enqueueIngest(id, doc.sourcePath, doc.datasetId);
  logger.info(`[Reingest] Queued document: ${id}`);
  return c.json({ ok: true, status: 'pending' });
});

export default app;
