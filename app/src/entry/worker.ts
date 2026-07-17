import { Queue, Worker } from 'bullmq';
import { config } from '@core/config';
import { ingestDocument } from '@features/kb/pipeline/ingest-pipeline';
import { logger } from '@core/utils/logger';

const connection = {
  url: config.redisUrl,
  maxRetriesPerRequest: null,
} as const;

export const ingestQueue = new Queue('ingest', { connection });

type IngestJobData = { docId: string; sourcePath: string; datasetId: string };

export function startWorker(): void {
  const worker = new Worker(
    'ingest',
    async (job) => {
      const { docId, sourcePath, datasetId } = job.data as IngestJobData;
      logger.info(`[Worker] Processing document: ${docId}`);
      await ingestDocument(docId, sourcePath, datasetId);
    },
    { connection, settings: { backoffStrategy: (attempts: number) => Math.pow(2, attempts) * 1000 } },
  );
  worker.on('completed', (job) => logger.info(`[Worker] Job completed: ${job.id}`));
  worker.on('failed', (job, err) => logger.error(`[Worker] Job failed: ${job?.id}`, err));
  logger.info('[Worker] Ingest worker started');
}

if (import.meta.main) {
  startWorker();
}
