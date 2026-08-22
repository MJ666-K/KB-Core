import { Hono, type Context } from 'hono';
import type { AuthEnv } from '../auth/middleware';
import { requirePermission, getAuthUser } from '../auth/middleware';
import { db } from '../db/client';
import { documents, chunks, datasets as datasetsSchema } from '../db/schema';
import { eq, and, isNull, desc, sql, inArray } from 'drizzle-orm';
import { readDocumentText, isKgSourcePath } from '../storage/document-storage';
import { normalizeDocumentContent } from '../utils/text-normalize';
import { resetDocumentForReingest, enqueueIngest } from '../pipeline/document-reset';
import { resolveDatasetAccess, accessibleDatasetIds, canManageAllDatasets, hasAccessLevel } from '../auth/access';
import { logger } from '../utils/logger';

const app = new Hono<AuthEnv>();

app.get('/', requirePermission('documents:read'), async (c) => {
  const user = getAuthUser(c);
  const sup = canManageAllDatasets(user.role, user.permissions);
  const accessibleIds = sup ? null : await accessibleDatasetIds(user.id, sup);
  const datasetId = c.req.query('datasetId');
  // 指定了 datasetId 但用户无权访问 → 返回空
  if (datasetId && accessibleIds && !accessibleIds.includes(datasetId)) {
    return c.json({ documents: [] });
  }
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
        accessibleIds ? inArray(documents.datasetId, accessibleIds) : undefined,
        status ? sql`${documents.status} = ${status}` : undefined,
        search ? sql`LOWER(${documents.title}) LIKE LOWER(${`%${search}%`})` : undefined,
      )!,
    )
    .orderBy(desc(documents.createdAt))
    .limit(limit)
    .offset(offset);

  const rows = await q;
  const enriched = await Promise.all(rows.map(async (r) => {
    const chunkCount = await db.select({ c: sql<number>`COUNT(*)` }).from(chunks).where(eq(chunks.documentId, r.id));
    return { ...r, chunkCount: Number(chunkCount[0]?.c ?? 0) };
  }));

  return c.json({ documents: enriched });
});

/** 加载文档并做行级校验；返回 {doc, ds} 或 {response} */
async function loadDocForAccess(c: Context<AuthEnv>, id: string, required: 'read' | 'write') {
  const [doc] = await db.select({
    id: documents.id, datasetId: documents.datasetId, sourcePath: documents.sourcePath,
  }).from(documents).where(and(eq(documents.id, id), isNull(documents.deletedAt)));
  if (!doc) return { response: c.json({ error: 'Document not found' }, 404) };
  const ds = await db.query.datasets.findFirst({ where: eq(datasetsSchema.id, doc.datasetId) });
  if (!ds) return { response: c.json({ error: 'Dataset not found' }, 404) };
  const user = getAuthUser(c);
  const access = await resolveDatasetAccess(ds, user.id, canManageAllDatasets(user.role, user.permissions));
  if (!hasAccessLevel(access, required)) {
    return { response: c.json({ error: 'Forbidden', detail: `需要 ${required} 权限` }, 403) };
  }
  return { doc, ds };
}

app.get('/:id', requirePermission('documents:read'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const loaded = await loadDocForAccess(c, id, 'read');
  if ('response' in loaded) return loaded.response;
  const rows = await db.select({
    id: documents.id, title: documents.title, docType: documents.docType,
    status: documents.status, fileSize: documents.fileSize, fileHash: documents.fileHash,
    contentHash: documents.contentHash, createdAt: documents.createdAt, updatedAt: documents.updatedAt,
    datasetId: documents.datasetId, datasetName: datasetsSchema.name,
  }).from(documents)
    .innerJoin(datasetsSchema, eq(documents.datasetId, datasetsSchema.id))
    .where(eq(documents.id, id));
  if (rows.length === 0) return c.json({ error: 'Document not found' }, 404);
  return c.json({ document: rows[0] });
});

app.get('/:id/content', requirePermission('documents:read'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const loaded = await loadDocForAccess(c, id, 'read');
  if ('response' in loaded) return loaded.response;
  try {
    const content = normalizeDocumentContent(await readDocumentText(loaded.doc.sourcePath, { documentId: id }));
    return c.text(content);
  } catch (err) {
    logger.error('[Documents] Failed to read content', { id, sourcePath: loaded.doc.sourcePath, err });
    return c.json({ error: 'Content not available' }, 404);
  }
});

app.get('/:id/chunks', requirePermission('documents:read'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const loaded = await loadDocForAccess(c, id, 'read');
  if ('response' in loaded) return loaded.response;
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
  const loaded = await loadDocForAccess(c, id, 'write');
  if ('response' in loaded) return loaded.response;
  await db.update(documents)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(documents.id, id));
  await db.delete(chunks).where(eq(chunks.documentId, id));
  return c.json({ ok: true });
});

app.post('/:id/reingest', requirePermission('documents:write'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const loaded = await loadDocForAccess(c, id, 'write');
  if ('response' in loaded) return loaded.response;
  if (isKgSourcePath(loaded.doc.sourcePath)) {
    return c.json({ error: 'KG virtual documents cannot be re-ingested' }, 400);
  }
  await resetDocumentForReingest(id);
  await enqueueIngest(id, loaded.doc.sourcePath, loaded.doc.datasetId);
  logger.info(`[Reingest] Queued document: ${id}`);
  return c.json({ ok: true, status: 'pending' });
});

export default app;
