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
  '3. 回答开头必须包含准确性提示（纯文字，不要加粗）：',
  '   以下回答未基于知识库检索，由 AI 基于通用法律知识生成，可能存在遗漏或偏差，不构成正式法律意见。具体事项请咨询专业律师。',
  '4. 不得编造具体法条编号或声称来自知识库。',
].join('\n');

/** 所有 Skill 统一输出格式约束（追加到 system prompt） */
export const OUTPUT_FORMAT_RULES = `
## 输出格式（强制遵守，使用标准 Markdown）

### 结构模板

1. **开篇**（1～2 句）：直接回答用户问题的核心结论，单独成段。
2. **正文分节**：按主题拆分为「一、二、三…」或「## 标题」，每节前空一行。
3. **小结**（可选）：末尾用「## 小结」或单独一段概括要点。

### 加粗规则

- 仅对**小节标题**（如「一、标准工时制度」）和**关键法律名称**加粗：\`**一、xxx**\` 或 \`## 一、xxx\`
- 正文普通叙述**不要**加粗，不要整段加粗
- 禁止连续多句都加粗

### 换行规则

- 每个自然段单独一段，段与段之间**空一行**（双换行）
- 小节标题与正文之间**空一行**
- 有序/无序列表每项**单独一行**，列表前后各空一行
- 禁止把多个小节挤在同一段落里

### 法条引用

- 格式：根据《法律名称》第X条规定，"原文或复述"[1]
- 同一句话末尾标注 [1][2]，不要每几个字就标一次

### 列表示例

\`\`\`
**一、加班时长限制**

根据《劳动法》第41条规定，……[1]

1. 一般每日不超过1小时
2. 特殊情况下每日不超过3小时
3. 每月不超过36小时

**二、加班费标准**

……
\`\`\`

### 禁止

- 禁止输出大段无换行的文字墙
- 禁止滥用 emoji
- 语气专业、客观、简洁
`.trim();

export const RETRIEVAL_FINAL_HINT =
  '你已完成所有检索。请停止继续搜索，直接基于以上检索到的法律条文，综合生成完整的最终回答。不要再提及"第X轮"、"下一步"或"进入"等检索计划用语。严格遵守输出格式：分节加粗标题、段间空行、列表每项一行。';

export const NO_RETRIEVAL_FINAL_HINT = [
  '知识库检索未获得可用法律条文。',
  '请直接基于通用法律知识回答，不要引用或编造具体法条原文。',
  '回答开头必须包含准确性提示（单独一段）：以下回答未基于知识库检索，仅供参考，请咨询专业律师。',
  '仍须遵守输出格式：分节、段间空行、列表每项一行。',
].join('\n');

export function buildSkillSystemPrompt(instructions: string): string {
  return `${instructions.trim()}\n\n${OUTPUT_FORMAT_RULES}`;
}

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
