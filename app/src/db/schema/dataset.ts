import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';

/** 数据集类型：document 普通文档库 / kg 知识图谱库 */
export const datasetKindEnum = pgEnum('dataset_kind', ['document', 'kg']);

export const datasets = pgTable('datasets', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  kind: datasetKindEnum('kind').notNull().default('document'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
