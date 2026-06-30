import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { extname } from 'path';
import { db } from '../db/client';
import { documents, datasets } from '../db/schema';
import { ingestQueue } from '../pipeline/queue';
import { fileHash } from '../utils/hash';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';

const app = new Hono();

const ALLOWED_EXTENSIONS = new Set(['.txt', '.md']);
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const datasetNameSchema = z.string().min(1).max(100).regex(
  /^[a-zA-Z0-9\u4e00-\u9fff_-]+$/,
  'Dataset name can only contain letters, numbers, Chinese, hyphens and underscores',
);

app.post('/ingest', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file');
  const datasetNameRaw = formData.get('dataset') ?? 'default';

  if (!(file instanceof File)) return c.json({ error: 'No file provided' }, 400);

  const datasetNameResult = datasetNameSchema.safeParse(datasetNameRaw);
  if (!datasetNameResult.success) return c.json({ error: 'Invalid dataset name', detail: datasetNameResult.error.issues }, 400);
  const datasetName = datasetNameResult.data;

  if (file.size > MAX_FILE_SIZE) return c.json({ error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` }, 400);

  const originalExt = extname(file.name).toLowerCase();
  const safeExt = ALLOWED_EXTENSIONS.has(originalExt) ? originalExt : '.txt';
  const safeName = `${Date.now()}-${nanoid(10)}${safeExt}`;
  const filePath = `./documents/${safeName}`;

  let dataset = await db.query.datasets.findFirst({ where: eq(datasets.name, datasetName) });
  if (!dataset) { const [d] = await db.insert(datasets).values({ name: datasetName }).returning(); dataset = d!; }

  const buffer = await file.arrayBuffer();
  await Bun.write(filePath, buffer);
  const fhash = await fileHash(filePath);

  const existing = await db.query.documents.findFirst({ where: eq(documents.fileHash, fhash) });
  if (existing && existing.status === 'ready') return c.json({ docId: existing.id, status: 'duplicate', message: 'File already ingested' });

  const [doc] = await db.insert(documents).values({
    datasetId: dataset.id, title: file.name.replace(/\.[^.]+$/, ''),
    sourcePath: filePath, fileHash: fhash, fileSize: file.size, status: 'pending',
  }).returning();

  await ingestQueue.add('ingest', { docId: doc!.id, sourcePath: filePath, datasetId: dataset.id });
  logger.info(`[Ingest] Queued document: ${doc!.id} (${file.name})`);
  return c.json({ docId: doc!.id, status: 'pending' });
});

export default app;
