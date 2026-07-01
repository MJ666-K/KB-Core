import type { SkillContext, SkillResult } from './types';
import type { FunctionDefinition, Message } from '../llm/llm-service';
import type { RetrievalResult } from '../retrieve/retriever';
import { formatCitations, deduplicateChunks } from './types';
import { logger } from '../utils/logger';

const MAX_SKILL_ITERATIONS = 3;

/**
 * 通用 Skill 执行器。
 * 读取 SKILL.md 的正文作为 LLM 指令，运行 mini Agent Loop 执行。
 *
 * 执行流程：
 * 1. SKILL.md 正文 → system prompt（LLM 执行指令）
 * 2. params → user message（参数）
 * 3. frontmatter 声明的 tools → 限制 LLM 可调用的工具
 * 4. LLM 按指令逐步调用 tools，直到给出最终回答
 */
export class SkillExecutor {
  /**
   * @param instructions  SKILL.md 正文（执行步骤）
   * @param allowedTools  SKILL.md frontmatter 声明的 tools 白名单
   * @param ctx           执行上下文（含 params, tools, llm）
   */
  async execute(
    instructions: string,
    allowedTools: readonly string[],
    ctx: SkillContext,
  ): Promise<SkillResult> {
    const toolDefs = this.filterToolDefs(ctx.tools, allowedTools);

    const messages: Message[] = [
      { role: 'system', content: instructions },
      { role: 'user', content: this.formatParams(ctx.params) },
    ];

    const allToolCalls: SkillResult['toolCalls'] = [];
    const allRetrievalResults: RetrievalResult[] = [];

    for (let iter = 0; iter < MAX_SKILL_ITERATIONS; iter++) {
      const response = await ctx.llm.chat({
        messages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        tool_choice: toolDefs.length > 0 ? 'auto' : undefined,
        temperature: 0.3,
      });

      if (!response.tool_calls?.length) {
        logger.debug(`[SkillExecutor] done in ${iter + 1} iteration(s)`);
        const deduped = deduplicateChunks(allRetrievalResults);
        return { answer: response.content ?? '', citations: formatCitations(deduped), toolCalls: allToolCalls };
      }

      messages.push({ role: 'assistant', content: response.content ?? '', tool_calls: response.tool_calls });

      for (const call of response.tool_calls) {
        let params: Record<string, unknown>;
        try { params = JSON.parse(call.function.arguments); } catch { params = {}; }

        const result = await ctx.executeTool(call.function.name, params);
        allToolCalls.push({ name: call.function.name, kind: 'tool', params });

        // 检查是否是 RetrievalResult[]，如果是则收集用于生成 citations
        if (this.isRetrievalResultArray(result)) {
          allRetrievalResults.push(...result);
        }

        const content = JSON.stringify(result);
        messages.push({
          role: 'tool', tool_call_id: call.id,
          content: content.length <= 4000 ? content : content.slice(0, 4000) + '\n[...截断...]',
        });
      }
    }

    logger.warn(`[SkillExecutor] max ${MAX_SKILL_ITERATIONS} iterations, forcing answer`);
    const final = await ctx.llm.chat({
      messages: [...messages, { role: 'user', content: '请基于以上信息给出最终回答。' }],
    });
    const deduped = deduplicateChunks(allRetrievalResults);
    return { answer: final.content ?? '', citations: formatCitations(deduped), toolCalls: allToolCalls };
  }

  private isRetrievalResultArray(result: unknown): result is RetrievalResult[] {
    if (!Array.isArray(result)) return false;
    if (result.length === 0) return false;
    const first = result[0];
    return typeof first === 'object' && first !== null &&
      'chunkId' in first && 'text' in first && 'score' in first &&
      'documentId' in first && 'documentTitle' in first;
  }

  private filterToolDefs(tools: SkillContext['tools'], allowed: readonly string[]): FunctionDefinition[] {
    if (allowed.length === 0) return [];
    const allowedSet = new Set(allowed);
    return tools.toFunctionDefinitions().filter(d => allowedSet.has(d.function.name));
  }

  private formatParams(params: Record<string, unknown>): string {
    const entries = Object.entries(params);
    if (entries.length === 0) return '请执行任务。';
    return `请执行任务，参数：\n${entries.map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`).join('\n')}`;
  }
}
