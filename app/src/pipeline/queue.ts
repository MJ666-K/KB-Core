import { Queue, Worker } from 'bullmq';
import { config } from '../config';
import { ingestDocument } from './ingest-pipeline';
import { logger } from '../utils/logger';

const connection = {
  url: config.redisUrl,
  maxRetriesPerRequest: null,
} as const;

export const ingestQueue = new Queue('ingest', { connection });

export function startWorker(): void {
  const worker = new Worker(
    'ingest',
    async (job) => {
      const { docId, sourcePath, datasetId } = job.data as { docId: string; sourcePath: string; datasetId: string; };
      logger.info(`[Worker] Processing document: ${docId}`);
      await ingestDocument(docId, sourcePath, datasetId);
    },
    { connection, settings: { backoffStrategy: (attempts: number) => Math.pow(2, attempts) * 1000 } },
  );
  worker.on('completed', (job) => logger.info(`[Worker] Job completed: ${job.id}`));
  worker.on('failed', (job, err) => logger.error(`[Worker] Job failed: ${job?.id}`, err));
  logger.info('[Worker] Ingest worker started');
}

// 支持独立运行：bun src/pipeline/queue.ts
if (import.meta.main) {
  startWorker();
}
