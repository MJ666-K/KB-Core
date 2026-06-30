import type { Message } from '../llm/llm-service';
import type { Citation, ToolCallRecord, AgentStep } from '../db/schema';

export interface QueryOptions {
  datasetId: string;
  userId?: string;
  topK?: number;
  maxIterations?: number;
  history?: Message[];
}

export interface QueryResult {
  answer: string;
  citations: Citation[];
  steps: AgentStep[];
  toolCalls: ToolCallRecord[];
  latencyMs: number;
  queryLogId: string;
  termination: 'skill' | 'synthesis' | 'direct';
}
