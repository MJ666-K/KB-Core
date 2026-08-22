import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { models } from './models';
import { users } from './user';
import { datasetVisibilityEnum } from './dataset';

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 同一 owner 下唯一（去全局 unique，允许多租户同名私有智能体） */
  name: text('name').notNull(),
  displayName: text('display_name').notNull(),
  description: text('description').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  modelId: uuid('model_id').notNull().references(() => models.id),
  /** 智能体声明的服务库（用于「选库后路由可用智能体」） */
  datasetIds: text('dataset_ids').array().notNull().default([]),
  skillNames: text('skill_names').array().default([]),
  personality: text('personality'),
  enabled: boolean('enabled').notNull().default(true),
  /** 创建者（多租户隔离核心字段） */
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  /** 当前仅启用 private/public；shared 预留二期（需 agent_members 表） */
  visibility: datasetVisibilityEnum('visibility').notNull().default('private'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('agent_owner_name_uniq').on(t.ownerId, t.name),
  index('agent_owner_idx').on(t.ownerId),
  index('agent_visibility_idx').on(t.visibility),
]);
