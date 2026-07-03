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

export type AgentEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking_token'; token: string }
  | { type: 'thinking_end' }
  | { type: 'tool_call_start'; name: string; kind: 'tool' | 'skill' }
  | { type: 'tool_call_end'; name: string; summary?: string }
  | { type: 'answer_start' }
  | { type: 'answer_token'; token: string }
  | { type: 'answer_end' }
  | { type: 'result_end'; citations: Citation[]; latencyMs: number; termination: string; queryLogId: string };

export interface EventStream {
  emit(event: AgentEvent): void;
}
