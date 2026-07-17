import { Hono } from 'hono';
import type { AuthEnv } from '@infra/auth/middleware';
import { requirePermission } from '@infra/auth/middleware';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { extname } from 'path';
import { db } from '@core/db/client';
import { documents, datasets } from '@core/db/schema';
import { enqueueIngest, resetDocumentForReingest } from '@features/kb/pipeline/document-reset';
import { hashBuffer, saveDocumentFile } from '@infra/storage/document-storage';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { logger } from '@core/utils/logger';
import { config } from '@core/config';

const app = new Hono<AuthEnv>();

const ALLOWED_EXTENSIONS = new Set(['.txt', '.md']);
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const datasetNameSchema = z.string().min(1).max(100).regex(
  /^[a-zA-Z0-9\u4e00-\u9fff_-]+$/,
  'Dataset name can only contain letters, numbers, Chinese, hyphens and underscores',
);

app.post('/ingest', requirePermission('documents:write'), async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file');
  const datasetRaw = formData.get('dataset') ?? formData.get('datasetId') ?? 'default';

  if (!(file instanceof File)) return c.json({ error: 'No file provided' }, 400);

  let datasetName: string;
  const asName = datasetNameSchema.safeParse(datasetRaw);
  if (asName.success) {
    datasetName = asName.data;
  } else {
    const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, String(datasetRaw)) });
    if (!ds) return c.json({ error: 'Invalid dataset' }, 400);
    datasetName = ds.name;
  }

  if (file.size > MAX_FILE_SIZE) return c.json({ error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` }, 400);

  const originalExt = extname(file.name).toLowerCase();
  const safeExt = ALLOWED_EXTENSIONS.has(originalExt) ? originalExt : '.txt';
  const safeName = `${Date.now()}-${nanoid(10)}${safeExt}`;
  const title = file.name.replace(/\.[^.]+$/, '');

  let dataset = await db.query.datasets.findFirst({ where: eq(datasets.name, datasetName) });
  if (!dataset) {
    const [d] = await db.insert(datasets).values({ name: datasetName }).returning();
    dataset = d!;
  }

  const buffer = await file.arrayBuffer();
  const fhash = hashBuffer(buffer);

  // 未删除的重复文件
  const active = await db.query.documents.findFirst({
    where: and(eq(documents.fileHash, fhash), isNull(documents.deletedAt)),
  });
  if (active?.status === 'ready') {
    return c.json({ docId: active.id, status: 'duplicate', message: 'File already ingested' });
  }

  const sourcePath = await saveDocumentFile(safeName, buffer);

  if (active) {
    await db.update(documents).set({
      datasetId: dataset.id,
      title,
      sourcePath,
      fileSize: file.size,
      status: 'pending',
      errorMsg: null,
      updatedAt: new Date(),
    }).where(eq(documents.id, active.id));
    await resetDocumentForReingest(active.id);
    await enqueueIngest(active.id, sourcePath, dataset.id);
    logger.info(`[Ingest] Re-queued existing document: ${active.id} (${file.name})`);
    return c.json({ docId: active.id, status: 'pending' });
  }

  // 曾软删除的同名内容：恢复记录并重新入库
  const deleted = await db.query.documents.findFirst({
    where: and(eq(documents.fileHash, fhash), isNotNull(documents.deletedAt)),
  });
  if (deleted) {
    await db.update(documents).set({
      deletedAt: null,
      datasetId: dataset.id,
      title,
      sourcePath,
      fileSize: file.size,
      status: 'pending',
      contentHash: null,
      errorMsg: null,
      embeddingModel: null,
      updatedAt: new Date(),
    }).where(eq(documents.id, deleted.id));
    await resetDocumentForReingest(deleted.id);
    await enqueueIngest(deleted.id, sourcePath, dataset.id);
    logger.info(`[Ingest] Restored deleted document: ${deleted.id} (${file.name})`);
    return c.json({ docId: deleted.id, status: 'pending', restored: true });
  }

  const [doc] = await db.insert(documents).values({
    datasetId: dataset.id,
    title,
    sourcePath,
    fileHash: fhash,
    fileSize: file.size,
    status: 'pending',
  }).returning();

  await enqueueIngest(doc!.id, sourcePath, dataset.id);
  logger.info(`[Ingest] Queued document: ${doc!.id} (${file.name})`, {
    storage: config.ossEnabled ? 'oss' : 'local',
    sourcePath,
  });
  return c.json({ docId: doc!.id, status: 'pending' });
});

export default app;
