import { pgTable, uuid, text, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { datasets } from './dataset';

export const documentStatusEnum = pgEnum('document_status', [
  'pending', 'parsing', 'chunking', 'embedding', 'ready', 'failed',
]);

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  datasetId: uuid('dataset_id').references(() => datasets.id).notNull(),
  title: text('title').notNull(),
  docType: text('doc_type').notNull().default('general'),
  sourcePath: text('source_path').notNull(),
  fileHash: text('file_hash').notNull(),
  contentHash: text('content_hash'),
  fileSize: integer('file_size').notNull(),
  status: documentStatusEnum('status').notNull().default('pending'),
  errorMsg: text('error_msg'),
  embeddingModel: text('embedding_model'),
  scope: text('scope').notNull().default('platform'),
  ownerId: text('owner_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});
