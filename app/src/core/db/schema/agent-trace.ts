import { pgTable, uuid, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';
import type { RetrievalDetails } from '@features/kb/retrieve/retriever';

export interface AgentStep {
  iteration: number;
  thought: string;
  action: string;
  params: Record<string, unknown>;
  resultSummary: string;
  retrievalDetails?: RetrievalDetails[];
}

export const agentTraces = pgTable('agent_traces', {
  id: uuid('id').primaryKey().defaultRandom(),
  queryLogId: uuid('query_log_id'),
  steps: jsonb('steps').$type<AgentStep[]>().default([]).notNull(),
  totalIterations: integer('total_iterations'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
