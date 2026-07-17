import { pgTable, uuid, text, timestamp, jsonb, integer, index } from 'drizzle-orm/pg-core';
import type { Citation } from './query-log';

export interface ChatMessageMeta {
  latencyMs?: number;
  termination?: string;
  toolCalls?: Array<{ name: string; kind: string }>;
  followUpQuestions?: string[];
  queryJobId?: string;
}

export const chatSessions = pgTable('chat_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  title: text('title').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('chat_sessions_updated_idx').on(table.updatedAt),
]);

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .references(() => chatSessions.id, { onDelete: 'cascade' })
    .notNull(),
  role: text('role').$type<'user' | 'assistant'>().notNull(),
  content: text('content').notNull(),
  citations: jsonb('citations').$type<Citation[]>().default([]).notNull(),
  meta: jsonb('meta').$type<ChatMessageMeta>().default({}).notNull(),
  sortOrder: integer('sort_order').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('chat_messages_session_idx').on(table.sessionId),
  index('chat_messages_session_sort_idx').on(table.sessionId, table.sortOrder),
]);
