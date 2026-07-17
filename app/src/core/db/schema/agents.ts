import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { models } from './models';

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').unique().notNull(),
  displayName: text('display_name').notNull(),
  description: text('description').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  modelId: uuid('model_id').notNull().references(() => models.id),
  datasetIds: text('dataset_ids').array().notNull().default([]),
  skillNames: text('skill_names').array().default([]),
  personality: text('personality'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
