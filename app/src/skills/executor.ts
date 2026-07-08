import type { SkillContext, SkillResult } from './types';
import type { FunctionDefinition, Message } from '../llm/llm-service';
import type { RetrievalResult } from '../retrieve/retriever';
import { formatCitations, deduplicateChunks, formatToolResultContent, isRetrievalResults, RETRIEVAL_FINAL_HINT, NO_RETRIEVAL_FINAL_HINT, buildSkillSystemPrompt } from './types';
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
    const skillStart = Date.now();

    logger.info(`[SkillExecutor] 开始执行`, {
      tools: allowedTools.length > 0 ? allowedTools.join(',') : '(none)',
      maxIterations: MAX_SKILL_ITERATIONS,
    });

    const messages: Message[] = [
      { role: 'system', content: buildSkillSystemPrompt(instructions) },
      { role: 'user', content: this.formatParams(ctx.params) },
    ];

    const allToolCalls: SkillResult['toolCalls'] = [];
    const allRetrievalResults: RetrievalResult[] = [];

    for (let iter = 0; iter < MAX_SKILL_ITERATIONS; iter++) {
      const isLastIter = iter === MAX_SKILL_ITERATIONS - 1;
      const hasTools = toolDefs.length > 0 && !isLastIter;

      const tokenBuffer: string[] = [];
      let toolCalls: import('../llm/llm-service').ToolCall[] | undefined;
      let answerStarted = false;

      const hasRetrieval = allRetrievalResults.length > 0;
      const iterMessages = isLastIter && messages.length > 2
        ? [...messages, {
            role: 'user' as const,
            content: hasRetrieval ? RETRIEVAL_FINAL_HINT : NO_RETRIEVAL_FINAL_HINT,
          }]
        : messages;

      for await (const chunk of ctx.llm.chatStream({
        messages: iterMessages,
        tools: hasTools ? toolDefs : undefined,
        tool_choice: hasTools ? 'auto' : undefined,
        temperature: 0.3,
      })) {
        if (chunk.type === 'token' && chunk.content) {
          tokenBuffer.push(chunk.content);
          // 工具调用轮通常无文本 token；有 token 即视为最终回答，实时转发
          if (ctx.events) {
            if (!answerStarted) {
              ctx.events.emit({ type: 'answer_start' });
              answerStarted = true;
            }
            ctx.events.emit({ type: 'answer_token', token: chunk.content });
          }
        } else if (chunk.type === 'done') {
          toolCalls = chunk.tool_calls;
        }
      }

      if (!toolCalls?.length) {
        const elapsed = Date.now() - skillStart;
        const answerText = tokenBuffer.join('');
        logger.info(`[SkillExecutor] 完成 (${iter + 1} 轮, ${elapsed}ms)`, {
          toolCalls: allToolCalls.map(tc => tc.name).join(',') || '(none)',
          answerLen: answerText.length,
        });

        if (answerStarted) {
          ctx.events?.emit({ type: 'answer_end' });
        }

        const deduped = deduplicateChunks(allRetrievalResults);
        return { answer: answerText, citations: formatCitations(deduped), toolCalls: allToolCalls };
      }

      messages.push({ role: 'assistant', content: tokenBuffer.join(''), tool_calls: toolCalls });

      for (const call of toolCalls) {
        let params: Record<string, unknown>;
        try { params = JSON.parse(call.function.arguments); } catch { params = {}; }

        ctx.events?.emit({ type: 'tool_call_start', name: call.function.name, kind: 'tool' });
        const result = await ctx.executeTool(call.function.name, params);
        allToolCalls.push({ name: call.function.name, kind: 'tool', params });
        const summary = typeof result === 'object' && result !== null && 'text' in result
          ? `找到 ${Array.isArray(result) ? (result as unknown[]).length : 1} 条结果`
          : undefined;
        ctx.events?.emit({ type: 'tool_call_end', name: call.function.name, summary });

        if (isRetrievalResults(result)) {
          allRetrievalResults.push(...result);
        }

        const content = formatToolResultContent(result, call.function.name);
        messages.push({
          role: 'tool', tool_call_id: call.id,
          content: content.length <= 8000 ? content : content.slice(0, 8000) + '\n[...截断...]',
        });
      }
    }

    logger.warn(`[SkillExecutor] max ${MAX_SKILL_ITERATIONS} iterations, forcing answer`);
    const forceHint = allRetrievalResults.length > 0
      ? RETRIEVAL_FINAL_HINT
      : NO_RETRIEVAL_FINAL_HINT;
    const forceMessages = [...messages, { role: 'user' as const, content: forceHint }];
    const answer = await this.streamFinalAnswer(ctx, forceMessages);
    const deduped = deduplicateChunks(allRetrievalResults);
    return { answer, citations: formatCitations(deduped), toolCalls: allToolCalls };
  }

  private async streamFinalAnswer(ctx: SkillContext, messages: Message[]): Promise<string> {
    if (!ctx.events) {
      const res = await ctx.llm.chat({ messages, temperature: 0.3 });
      return res.content ?? '';
    }

    ctx.events.emit({ type: 'answer_start' });

    const tokenBuffer: string[] = [];
    for await (const chunk of ctx.llm.chatStream({ messages, temperature: 0.3 })) {
      if (chunk.type === 'token' && chunk.content) {
        tokenBuffer.push(chunk.content);
        ctx.events.emit({ type: 'answer_token', token: chunk.content });
      }
    }

    ctx.events.emit({ type: 'answer_end' });
    return tokenBuffer.join('');
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
