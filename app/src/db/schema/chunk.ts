import {
  pgTable, uuid, text, integer, timestamp, vector, pgEnum, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { documents } from './document';
import { datasets } from './dataset';

export const embeddingStatusEnum = pgEnum('embedding_status', [
  'pending', 'done', 'failed',
]);

export const chunks = pgTable('chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id')
    .references(() => documents.id, { onDelete: 'cascade' })
    .notNull(),
  // 修复 #10：datasetId 加外键
  datasetId: uuid('dataset_id')
    .references(() => datasets.id, { onDelete: 'cascade' })
    .notNull(),
  parentId: uuid('parent_id'),
  // 修复 #12：parentChunkIndex + childIndexWithinParent
  parentChunkIndex: integer('parent_chunk_index').notNull(),
  childIndexWithinParent: integer('child_index_within_parent'),
  // 兼容字段（旧 schema 遗留，drizzle-kit 需要）
  chunkIndex: integer('chunk_index').notNull().default(0),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  tokenCount: integer('token_count').notNull(),
  embedding: vector('embedding', { dimensions: 1024 }),
  embeddingStatus: embeddingStatusEnum('embedding_status').notNull().default('pending'),
  scope: text('scope').notNull().default('platform'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('chunk_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  index('chunk_document_idx').on(table.documentId),
  index('chunk_parent_idx').on(table.parentId),
  index('chunk_dataset_idx').on(table.datasetId),
  uniqueIndex('chunk_doc_parent_child_uniq').on(
    table.documentId,
    table.parentChunkIndex,
    table.childIndexWithinParent,
  ),
]);
