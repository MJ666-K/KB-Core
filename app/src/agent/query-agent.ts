import type { LLMService, Message } from '../llm/llm-service';
import type { SkillRegistry } from '../skills/registry';
import type { ToolRegistry } from '../tools/registry';
import type { HookRegistry } from '../hooks/registry';
import type { SkillContext, SkillResult } from '../skills/types';
import { SkillExecutor } from '../skills/executor';
import type { Citation, ToolCallRecord, AgentStep } from '../db/schema';
import { buildSystemPrompt } from './system-prompt';
import type { QueryOptions, QueryResult } from './types';
import { db } from '../db/client';
import { queryLogs, agentTraces } from '../db/schema';
import { config } from '../config';
import { logger } from '../utils/logger';

function deduplicateCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter(c => { if (seen.has(c.chunkId)) return false; seen.add(c.chunkId); return true; });
}

export class QueryAgent {
  constructor(
    private readonly llm: LLMService,
    private readonly skillRegistry: SkillRegistry,
    private readonly toolRegistry: ToolRegistry,
    private readonly hookRegistry: HookRegistry,
  ) {}

  async execute(query: string, options: QueryOptions): Promise<QueryResult> {
    const startTime = Date.now();
    const steps: AgentStep[] = [];
    const allToolCalls: ToolCallRecord[] = [];
    const skillResults: SkillResult[] = [];
    let directAnswer: string | null = null;

    const messages: Message[] = [
      { role: 'system', content: buildSystemPrompt(this.skillRegistry, this.toolRegistry) },
      ...(options.history ?? []),
      { role: 'user', content: query },
    ];

    const maxIterations = options.maxIterations ?? config.agentMaxIterations;

    for (let iter = 0; iter < maxIterations; iter++) {
      const response = await this.llm.chat({
        messages,
        tools: [...this.skillRegistry.toFunctionDefinitions(), ...this.toolRegistry.toFunctionDefinitions()],
        tool_choice: 'auto',
      });

      if (!response.tool_calls?.length) {
        directAnswer = response.content ?? '';
        steps.push({ iteration: iter, thought: '直接回答', action: 'answer', params: {}, resultSummary: directAnswer.slice(0, 200) });
        break;
      }

      messages.push({ role: 'assistant', content: response.content ?? '', tool_calls: response.tool_calls });

      for (const call of response.tool_calls) {
        const name = call.function.name;
        let params: Record<string, unknown>;
        try { params = JSON.parse(call.function.arguments); } catch { params = {}; }

        steps.push({ iteration: iter, thought: response.content ?? '', action: name, params, resultSummary: '' });

        const result = await this.executeCallable(name, params, options);
        allToolCalls.push({ name, kind: this.skillRegistry.has(name) ? 'skill' : 'tool', params });

        if (this.isSkillResult(result)) {
          skillResults.push(result);
          const summary = this.summarizeSkillResult(name, result);
          messages.push({ role: 'tool', tool_call_id: call.id, content: summary });
          steps[steps.length - 1]!.resultSummary = summary;
        } else {
          const toolContent = this.formatToolResult(result);
          messages.push({ role: 'tool', tool_call_id: call.id, content: toolContent });
          steps[steps.length - 1]!.resultSummary = toolContent.slice(0, 200);
        }
      }
    }

    const { answer, citations, termination } = await this.resolveFinalAnswer(query, messages, skillResults, directAnswer, options);
    const latencyMs = Date.now() - startTime;
    const queryLogId = await this.logQuery(query, answer, citations, allToolCalls, steps, latencyMs, options);

    return { answer, citations, steps, toolCalls: allToolCalls, latencyMs, queryLogId, termination };
  }

  private async resolveFinalAnswer(
    query: string, messages: Message[], skillResults: SkillResult[], directAnswer: string | null, _options: QueryOptions,
  ): Promise<{ answer: string; citations: Citation[]; termination: 'skill' | 'synthesis' | 'direct' }> {
    if (skillResults.length > 0) {
      const lastSkill = skillResults[skillResults.length - 1]!;
      const allCitations = skillResults.flatMap(sr => sr.citations);
      return { answer: lastSkill.answer, citations: deduplicateCitations(allCitations), termination: 'skill' };
    }
    if (directAnswer !== null) return { answer: directAnswer, citations: [], termination: 'direct' };
    const finalResponse = await this.llm.chat({ messages: [...messages, { role: 'user', content: '请基于以上检索到的资料，给出最终回答。标注引用来源。' }] });
    return { answer: finalResponse.content ?? '（无法生成回答）', citations: [], termination: 'synthesis' };
  }

  private isSkillResult(result: unknown): result is SkillResult {
    return typeof result === 'object' && result !== null && 'answer' in result && 'citations' in result && 'toolCalls' in result;
  }

  private summarizeSkillResult(name: string, result: SkillResult): string {
    return `Skill "${name}" 已完成。答案长度: ${result.answer.length} 字符，引用数: ${result.citations.length}。\n答案已由系统收集，你不需要重新生成。`;
  }

  private formatToolResult(result: unknown): string {
    const json = JSON.stringify(result);
    return json.length <= 4000 ? json : json.slice(0, 4000) + '\n[...结果已截断...]';
  }

  private async executeCallable(name: string, params: Record<string, unknown>, options: QueryOptions): Promise<unknown> {
    const beforeResult = await this.hookRegistry.runBefore(name, params, { datasetId: options.datasetId, userId: options.userId }).catch(err => { logger.warn(`[Hook before] ${name} threw`, err); return undefined; });
    if (beforeResult?.block) return { error: beforeResult.reason ?? 'blocked by hook' };

    const skill = this.skillRegistry.get(name);
    let result: unknown;
    if (skill) {
      const ctx = this.buildSkillContext(params, options);
      const executor = new SkillExecutor();
      try { result = await executor.execute(skill.instructions, skill.metadata.tools, ctx); } catch (err) { logger.error(`[Skill ${name}] failed`, err); result = { error: `Skill ${name} failed: ${err instanceof Error ? err.message : String(err)}` }; }
    } else {
      const tool = this.toolRegistry.get(name);
      if (!tool) return { error: `Unknown callable: ${name}` };
      try { result = await tool.execute(params, { datasetId: options.datasetId }); } catch (err) { logger.error(`[Tool ${name}] failed`, err); result = { error: `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}` }; }
    }

    try { const afterResult = await this.hookRegistry.runAfter(name, result, { datasetId: options.datasetId, userId: options.userId }); if (afterResult !== undefined) result = afterResult; } catch (err) { logger.warn(`[Hook after] ${name} threw`, err); }
    return result;
  }

  private buildSkillContext(params: Record<string, unknown>, options: QueryOptions): SkillContext {
    const self = this;
    return {
      params, datasetId: options.datasetId, userId: options.userId, history: options.history,
      tools: this.toolRegistry, llm: this.llm, hooks: this.hookRegistry,
      async executeTool(name, toolParams) { return self.executeCallable(name, toolParams, options); },
    };
  }

  private async logQuery(query: string, answer: string, citations: Citation[], toolCalls: ToolCallRecord[], steps: AgentStep[], latencyMs: number, _options: QueryOptions): Promise<string> {
    try {
      const [log] = await db.insert(queryLogs).values({ query, answer, citations, toolCalls, latencyMs }).returning({ id: queryLogs.id });
      await db.insert(agentTraces).values({ queryLogId: log!.id, steps, totalIterations: steps.length });
      return log!.id;
    } catch (err) { logger.error('[Agent] Failed to write query log', err); return '00000000-0000-0000-0000-000000000000'; }
  }
}
