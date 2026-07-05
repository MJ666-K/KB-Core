import type { ToolRegistry } from '../tools/registry';
import type { LLMService, Message } from '../llm/llm-service';
import type { HookRegistry } from '../hooks/registry';
import type { RetrievalResult } from '../retrieve/retriever';
import type { Citation, ToolCallRecord } from '../db/schema';
import type { JSONSchemaProperty } from '../tools/types';
import type { EventStream } from '../agent/types';

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
  datasetIds?: readonly string[];
  userId?: string;
  queryLogId?: string;
  history?: Message[];
  tools: ToolRegistry;
  llm: LLMService;
  hooks: HookRegistry;
  events?: EventStream;
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

/** 检索无结果时传给 LLM 的 tool 内容（不含任何文档片段） */
export const NO_RETRIEVAL_TOOL_CONTENT = [
  '【检索结果】知识库未找到相关法律条文（空结果）。',
  '',
  '请遵守：',
  '1. 不要将任何知识库文档内容注入回答；',
  '2. 可基于通用法律知识回答用户问题；',
  '3. 回答开头必须包含准确性提示（原样或同义）：',
  '   ⚠️ 以下回答未基于知识库检索，由 AI 基于通用法律知识生成，可能存在遗漏或偏差，不构成正式法律意见。具体事项请咨询专业律师。',
  '4. 不得编造具体法条编号或声称来自知识库。',
].join('\n');

export const RETRIEVAL_FINAL_HINT =
  '你已完成所有检索。请停止继续搜索，直接基于以上检索到的法律条文，综合生成完整的最终回答。不要再提及"第X轮"、"下一步"或"进入"等检索计划用语。';

export const NO_RETRIEVAL_FINAL_HINT = [
  '知识库检索未获得可用法律条文。',
  '请直接基于通用法律知识回答，不要引用或编造具体法条原文。',
  '回答开头必须包含准确性提示：未基于知识库检索，仅供参考，请咨询专业律师。',
].join('\n');

export function isEmptyRetrieval(result: unknown): boolean {
  return Array.isArray(result) && result.length === 0;
}

export function isRetrievalResults(result: unknown): result is RetrievalResult[] {
  if (!Array.isArray(result) || result.length === 0) return false;
  const first = result[0];
  return typeof first === 'object' && first !== null &&
    'chunkId' in first && 'text' in first && 'score' in first &&
    'documentId' in first && 'documentTitle' in first;
}

export function formatToolResultContent(result: unknown, toolName: string): string {
  if (toolName === 'search_knowledge' && isEmptyRetrieval(result)) {
    return NO_RETRIEVAL_TOOL_CONTENT;
  }
  if (isRetrievalResults(result)) {
    return buildContext(result);
  }
  return JSON.stringify(result);
}
