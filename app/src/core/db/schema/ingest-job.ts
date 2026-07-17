import { pgTable, uuid, text, timestamp, jsonb, integer, pgEnum } from 'drizzle-orm/pg-core';
import { documents } from './document';

export const ingestStageEnum = pgEnum('ingest_stage', ['parse', 'chunk', 'embed']);
export const ingestStatusEnum = pgEnum('ingest_status', ['running', 'done', 'failed']);

export const ingestJobs = pgTable('ingest_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id')
    .references(() => documents.id, { onDelete: 'cascade' })
    .notNull(),
  stage: ingestStageEnum('stage').notNull(),
  status: ingestStatusEnum('status').notNull(),
  attempt: integer('attempt').default(0).notNull(),
  result: jsonb('result'),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
