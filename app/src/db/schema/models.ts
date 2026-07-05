import { pgTable, uuid, text, boolean, timestamp, real, integer } from 'drizzle-orm/pg-core';

export const models = pgTable('models', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').unique().notNull(),
  displayName: text('display_name').notNull(),
  provider: text('provider').notNull(),
  modelId: text('model_id').notNull(),
  apiUrl: text('api_url'),
  apiKey: text('api_key'),
  enabled: boolean('enabled').notNull().default(true),
  temperature: real('temperature').notNull().default(0.2),
  maxTokens: integer('max_tokens').notNull().default(2048),
  topK: integer('top_k').default(0),
  topP: real('top_p').default(0.9),
  frequencyPenalty: real('frequency_penalty').default(0),
  presencePenalty: real('presence_penalty').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
