import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { chunks, documents, ingestJobs } from '../db/schema';
import { ingestQueue } from './queue';
import { logger } from '../utils/logger';

export function ingestJobId(docId: string): string {
  return `ingest-${docId}`;
}

/** 清除文档入库产物，准备重新嵌入 */
export async function resetDocumentForReingest(docId: string): Promise<void> {
  await db.delete(chunks).where(eq(chunks.documentId, docId));
  await db.delete(ingestJobs).where(eq(ingestJobs.documentId, docId));
  await db.update(documents).set({
    status: 'pending',
    contentHash: null,
    errorMsg: null,
    embeddingModel: null,
    updatedAt: new Date(),
  }).where(eq(documents.id, docId));

  await removeQueuedIngestJobs(docId);
  logger.info(`[Reingest] Cleared old data for document: ${docId}`);
}

async function removeQueuedIngestJobs(docId: string): Promise<void> {
  const jobId = ingestJobId(docId);
  const existing = await ingestQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'active') {
      logger.warn(`[Reingest] Document ${docId} ingest job is active, waiting for removal`);
    }
    await existing.remove();
  }

  for (const state of ['waiting', 'delayed', 'paused'] as const) {
    const jobs = await ingestQueue.getJobs([state]);
    for (const job of jobs) {
      const data = job.data as { docId?: string };
      if (data.docId === docId && job.id !== jobId) {
        await job.remove();
      }
    }
  }
}

export async function enqueueIngest(docId: string, sourcePath: string, datasetId: string): Promise<void> {
  const jobId = ingestJobId(docId);
  const existing = await ingestQueue.getJob(jobId);
  if (existing) await existing.remove();

  await ingestQueue.add(
    'ingest',
    { docId, sourcePath, datasetId },
    { jobId, removeOnComplete: 100, removeOnFail: 50 },
  );
}
