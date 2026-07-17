import { pgTable, uuid, text, boolean, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const skillDefinitions = pgTable('skill_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').unique().notNull(),
  displayName: text('display_name').notNull(),
  description: text('description').notNull(),
  tools: text('tools').array().notNull().default([]),
  parameters: jsonb('parameters').notNull().default({}),
  instructions: text('instructions').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdBy: text('created_by'),
});
