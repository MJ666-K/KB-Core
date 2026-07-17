import { pgTable, uuid, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';

export interface Citation {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  excerpt: string;
  score: number;
}

export interface ToolCallRecord {
  name: string;
  kind: 'tool' | 'skill';
  params: Record<string, unknown>;
  result?: unknown;
  latencyMs?: number;
}

export const queryLogs = pgTable('query_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  query: text('query').notNull(),
  datasetId: uuid('dataset_id'),
  answer: text('answer'),
  citations: jsonb('citations').$type<Citation[]>().default([]).notNull(),
  toolCalls: jsonb('tool_calls').$type<ToolCallRecord[]>().default([]).notNull(),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
