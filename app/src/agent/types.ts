import type { Message } from '../llm/llm-service';
import type { Citation, ToolCallRecord, AgentStep } from '../db/schema';

export interface QueryOptions {
  datasetId: string;
  datasetIds?: readonly string[];
  userId?: string;
  topK?: number;
  maxIterations?: number;
  history?: Message[];
  agentName?: string;
  model?: string;
  /** 子 Agent 调用时为 false，避免重复生成推荐追问 */
  generateFollowUps?: boolean;
}

export interface QueryResult {
  answer: string;
  citations: Citation[];
  steps: AgentStep[];
  toolCalls: ToolCallRecord[];
  latencyMs: number;
  queryLogId: string;
  termination: 'skill' | 'synthesis' | 'direct';
  followUpQuestions?: string[];
}

export interface SubAgentRef {
  name: string;
  displayName: string;
}

export type AgentEvent =
  | { type: 'thinking_start'; subAgent?: SubAgentRef }
  | { type: 'thinking_token'; token: string; subAgent?: SubAgentRef }
  | { type: 'thinking_end'; subAgent?: SubAgentRef }
  | { type: 'tool_call_start'; name: string; kind: 'tool' | 'skill'; subAgent?: SubAgentRef }
  | { type: 'tool_call_end'; name: string; summary?: string; subAgent?: SubAgentRef }
  | { type: 'retrieval_results'; name: string; results: Array<{ chunkId: string; text: string; score: number; documentTitle?: string }> }
  | { type: 'answer_start' }
  | { type: 'answer_token'; token: string }
  | { type: 'answer_end' }
  | { type: 'follow_up'; questions: string[] }
  | { type: 'result_end'; citations: Citation[]; latencyMs: number; termination: string; queryLogId: string };

export interface EventStream {
  emit(event: AgentEvent): void;
}
