import { db } from '@core/db/client';
import { chunks, documents, ingestJobs } from '@core/db/schema';
import { eq } from 'drizzle-orm';
import { TxtParser } from '@features/kb/parser/txt-parser';
import { createSplitter } from '@features/kb/splitter';
import { EmbeddingService } from '@infra/embedding/embedding-service';
import { logger } from '@core/utils/logger';
import { sha256 } from '@core/utils/hash';
import { sql } from 'drizzle-orm';
import { config } from '@core/config';
import { getChunkSettings } from '@infra/settings/effective-config';

const parser = new TxtParser();
const embeddingService = new EmbeddingService();

async function recordJob(docId: string, stage: 'parse' | 'chunk' | 'embed', status: 'running' | 'done' | 'failed', result?: Record<string, unknown>): Promise<void> {
  await db.insert(ingestJobs).values({
    documentId: docId, stage, status, result: result ?? {},
    startedAt: status === 'running' ? new Date() : undefined,
    finishedAt: status !== 'running' ? new Date() : undefined,
  });
}

async function updateDocStatus(docId: string, status: 'pending' | 'parsing' | 'chunking' | 'embedding' | 'ready' | 'failed', errorMsg?: string): Promise<void> {
  await db.update(documents).set({ status, errorMsg, updatedAt: new Date() }).where(eq(documents.id, docId));
}

export async function ingestDocument(docId: string, sourcePath: string, datasetId: string): Promise<void> {
  logger.info(`[Ingest] Start doc=${docId}`, { sourcePath, datasetId });
  try {
    // 幂等：Worker 开始前再清一次，避免重复任务残留旧 chunks
    await db.delete(chunks).where(eq(chunks.documentId, docId));

    await updateDocStatus(docId, 'parsing');
    await recordJob(docId, 'parse', 'running');
    logger.info(`[Ingest] Parse start doc=${docId}`);
    const doc = await parser.parse(sourcePath);
    const contentHash = sha256(doc.content);
    await db.update(documents).set({ contentHash }).where(eq(documents.id, docId));
    await recordJob(docId, 'parse', 'done', { chars: doc.content.length });
    logger.info(`[Ingest] Parse done doc=${docId}`, {
      title: doc.title,
      chars: doc.content.length,
      docType: doc.docType,
    });

    await updateDocStatus(docId, 'chunking');
    await recordJob(docId, 'chunk', 'running');
    const chunkSettings = getChunkSettings();
    logger.info(`[Ingest] Chunk start doc=${docId}`, chunkSettings);
    const units = createSplitter().split(doc.content, { docType: doc.docType, title: doc.title });
    const parentUnits = units.filter(u => u.isParent);
    const childUnits = units.filter(u => !u.isParent);

    const childrenByParent = new Map<number, number>();
    for (const u of childUnits) {
      childrenByParent.set(u.parentChunkIndex, (childrenByParent.get(u.parentChunkIndex) ?? 0) + 1);
    }
    logger.info(`[Ingest] Chunk split doc=${docId}`, {
      parents: parentUnits.length,
      children: childUnits.length,
      childrenPerParent: Object.fromEntries(childrenByParent),
    });

    logger.info(`[Ingest] Save parents doc=${docId}`, { count: parentUnits.length });
    const parentRows = await db.insert(chunks).values(
      parentUnits.map((u, idx) => ({
        documentId: docId, parentId: null,
        parentChunkIndex: u.parentChunkIndex, childIndexWithinParent: null, chunkIndex: idx,
        content: u.text, contentHash: u.contentHash, tokenCount: u.tokenCount,
        startOffset: u.startOffset, endOffset: u.endOffset,
        scope: 'platform', datasetId,
      })),
    ).returning({ id: chunks.id, parentChunkIndex: chunks.parentChunkIndex });

    const parentIdMap = new Map<number, string>();
    for (const row of parentRows) parentIdMap.set(row.parentChunkIndex, row.id);

    logger.info(`[Ingest] Save children doc=${docId}`, { count: childUnits.length });
    const childRows = await db.insert(chunks).values(
      childUnits.map((u) => ({
        documentId: docId, parentId: parentIdMap.get(u.parentChunkIndex) ?? null,
        parentChunkIndex: u.parentChunkIndex, childIndexWithinParent: u.childIndexWithinParent,
        chunkIndex: u.parentChunkIndex * 1000 + (u.childIndexWithinParent ?? 0),
        content: u.text, contentHash: u.contentHash, tokenCount: u.tokenCount,
        startOffset: u.startOffset, endOffset: u.endOffset,
        scope: 'platform', datasetId,
      })),
    ).returning({ id: chunks.id });

    await recordJob(docId, 'chunk', 'done', { parents: parentUnits.length, children: childUnits.length });
    logger.info(`[Ingest] Chunk done doc=${docId}`, {
      parents: parentUnits.length,
      children: childUnits.length,
    });

    await updateDocStatus(docId, 'embedding');
    await recordJob(docId, 'embed', 'running');
    const childIds = childRows.map(r => r.id);
    const texts = childUnits.map(u => u.text);
    const embedBatches = Math.ceil(texts.length / config.embeddingBatchSize) || 0;
    logger.info(`[Ingest] Embed start doc=${docId}`, {
      children: texts.length,
      batchSize: config.embeddingBatchSize,
      batches: embedBatches,
    });
    const embeddings = await embeddingService.embedBatch(texts, {
      onBatch: (batchIndex, totalBatches, batchSize) => {
        logger.info(`[Ingest] Embed batch doc=${docId}`, {
          batch: `${batchIndex}/${totalBatches}`,
          size: batchSize,
        });
      },
    });

    // 批量 UPDATE embeddings（分批避免 SQL 过长）
    const UPDATE_BATCH = 25;
    const updateBatches = Math.ceil(childIds.length / UPDATE_BATCH) || 0;
    for (let batch = 0; batch < childIds.length; batch += UPDATE_BATCH) {
      const sliceEnd = Math.min(batch + UPDATE_BATCH, childIds.length);
      const batchNo = Math.floor(batch / UPDATE_BATCH) + 1;
      logger.info(`[Ingest] Embed persist doc=${docId}`, {
        batch: `${batchNo}/${updateBatches}`,
        rows: sliceEnd - batch,
      });
      const valuesParts: string[] = [];
      for (let i = batch; i < sliceEnd; i++) {
        valuesParts.push(`('${childIds[i]}'::uuid, '[${embeddings[i]!.join(',')}]'::vector)`);
      }
      await db.execute(sql`
        UPDATE chunks SET embedding = v.embedding, embedding_status = 'done'
        FROM (VALUES ${sql.raw(valuesParts.join(', '))}) AS v(id, embedding)
        WHERE chunks.id = v.id
      `);
    }

    await recordJob(docId, 'embed', 'done', { embedded: childIds.length });
    await updateDocStatus(docId, 'ready');
    logger.info(`[Ingest] Done doc=${docId}`, {
      title: doc.title,
      parents: parentUnits.length,
      children: childUnits.length,
      embedded: childIds.length,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[Ingest] Failed doc=${docId}`, { error: errorMsg });
    await updateDocStatus(docId, 'failed', errorMsg);
    await recordJob(docId, 'embed', 'failed', { error: errorMsg });
    throw err;
  }
}
