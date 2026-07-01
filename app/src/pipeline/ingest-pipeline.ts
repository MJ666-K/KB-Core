import { db } from '../db/client';
import { chunks, documents, ingestJobs } from '../db/schema';
import { eq } from 'drizzle-orm';
import { TxtParser } from '../parser/txt-parser';
import { createSplitter } from '../splitter';
import { EmbeddingService } from '../embedding/embedding-service';
import { logger } from '../utils/logger';
import { sha256 } from '../utils/hash';
import { sql } from 'drizzle-orm';

const parser = new TxtParser();
const splitter = createSplitter();
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
  try {
    await updateDocStatus(docId, 'parsing');
    await recordJob(docId, 'parse', 'running');
    const doc = await parser.parse(sourcePath);
    const contentHash = sha256(doc.content);
    await db.update(documents).set({ contentHash }).where(eq(documents.id, docId));
    await recordJob(docId, 'parse', 'done', { chars: doc.content.length });

    await updateDocStatus(docId, 'chunking');
    await recordJob(docId, 'chunk', 'running');
    const units = splitter.split(doc.content, { docType: doc.docType, title: doc.title });
    const parentUnits = units.filter(u => u.isParent);
    const childUnits = units.filter(u => !u.isParent);

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

    await updateDocStatus(docId, 'embedding');
    await recordJob(docId, 'embed', 'running');
    const childIds = childRows.map(r => r.id);
    const texts = childUnits.map(u => u.text);
    const embeddings = await embeddingService.embedBatch(texts);

    // 批量 UPDATE embeddings（分批避免 SQL 过长）
    const UPDATE_BATCH = 25;
    for (let batch = 0; batch < childIds.length; batch += UPDATE_BATCH) {
      const sliceEnd = Math.min(batch + UPDATE_BATCH, childIds.length);
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
    logger.info(`[Ingest] Document ${docId} ready: ${parentUnits.length} parents, ${childUnits.length} children`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await updateDocStatus(docId, 'failed', errorMsg);
    await recordJob(docId, 'embed', 'failed', { error: errorMsg });
    throw err;
  }
}
