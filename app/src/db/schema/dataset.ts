import { pgTable, uuid, text, timestamp, pgEnum, index, uniqueIndex, jsonb } from 'drizzle-orm/pg-core';
import { users } from './user';

/** 数据集类型：document 普通文档库 / kg 知识图谱库 */
export const datasetKindEnum = pgEnum('dataset_kind', ['document', 'kg']);

/** 数据集可见性：private 仅 owner / shared 指定成员（见 dataset_members）/ public 所有人可读 */
export const datasetVisibilityEnum = pgEnum('dataset_visibility', ['private', 'shared', 'public']);

/** 库级切割配置覆盖（Partial，空字段回退全局默认） */
export interface DatasetChunkConfig {
  parentTokens: number;
  childTokens: number;
  overlapTokens: number;
}

/** 库级召回配置覆盖（不含 agent/cache 参数，那些保持全局） */
export interface DatasetRetrieveConfig {
  searchTopK: number;
  denseTopKMultiplier: number;
  rrfK: number;
  rerankTopK: number;
  denseMinSimilarity: number;
  rerankMinScore: number;
}

export const datasets = pgTable('datasets', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 同一 owner 下唯一（去全局 unique，允许多租户同名私有库） */
  name: text('name').notNull(),
  description: text('description'),
  kind: datasetKindEnum('kind').notNull().default('document'),
  /** 创建者（多租户隔离核心字段） */
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  visibility: datasetVisibilityEnum('visibility').notNull().default('private'),
  /** 库级配置覆盖，null/空字段回退 data/settings.json 全局默认 */
  chunkConfig: jsonb('chunk_config').$type<Partial<DatasetChunkConfig>>(),
  retrieveConfig: jsonb('retrieve_config').$type<Partial<DatasetRetrieveConfig>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('dataset_owner_name_uniq').on(t.ownerId, t.name),
  index('dataset_owner_idx').on(t.ownerId),
  index('dataset_visibility_idx').on(t.visibility),
]);
