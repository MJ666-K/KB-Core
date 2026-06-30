import type { ToolRegistry } from '../tools/registry';
import type { LLMService, Message } from '../llm/llm-service';
import type { HookRegistry } from '../hooks/registry';
import type { RetrievalResult } from '../retrieve/retriever';
import type { Citation, ToolCallRecord } from '../db/schema';
import type { JSONSchemaProperty } from '../tools/types';

/** SKILL.md frontmatter 解析结果 */
export interface SkillMetadata {
  name: string;
  description: string;
  tools: string[];
  parameters: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required: string[];
  };
}

/** Skill 执行上下文 */
export interface SkillContext {
  params: Record<string, unknown>;
  datasetId: string;
  userId?: string;
  queryLogId?: string;
  history?: Message[];
  tools: ToolRegistry;
  llm: LLMService;
  hooks: HookRegistry;
  executeTool(name: string, params: Record<string, unknown>): Promise<unknown>;
}

/** Skill 返回结果 */
export interface SkillResult {
  answer: string;
  citations: Citation[];
  toolCalls: ToolCallRecord[];
}

/** 运行时加载的 Skill（metadata + 指令正文，全部来自 SKILL.md） */
export interface Skill {
  metadata: SkillMetadata;
  instructions: string;       // SKILL.md 正文（LLM 执行指令）
}

export function formatCitations(results: RetrievalResult[]): Citation[] {
  return results.map(r => ({
    chunkId: r.chunkId, documentId: r.documentId, documentTitle: r.documentTitle,
    excerpt: r.text.slice(0, 200), score: r.score,
  }));
}

export function buildContext(results: RetrievalResult[]): string {
  return results.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n');
}

export function deduplicateChunks(chunks: RetrievalResult[]): RetrievalResult[] {
  const seen = new Set<string>();
  return chunks.filter(c => { if (seen.has(c.chunkId)) return false; seen.add(c.chunkId); return true; });
}
