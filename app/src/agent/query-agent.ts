import type { LLMService, Message, ChatResponse, ToolCall, ChatOptions } from '../llm/llm-service';
import type { SkillRegistry } from '../skills/registry';
import type { ToolRegistry } from '../tools/registry';
import type { HookRegistry } from '../hooks/registry';
import type { SkillContext, SkillResult } from '../skills/types';
import { SkillExecutor } from '../skills/executor';
import { drainRetrievalDetails } from '../tools/search-knowledge';
import type { Citation, ToolCallRecord, AgentStep } from '../db/schema';
import { formatCitations, deduplicateChunks, SYNTHESIS_FINAL_HINT } from '../skills/types';
import type { RetrievalResult } from '../retrieve/retriever';
import { buildSystemPrompt } from './system-prompt';
import type { QueryOptions, QueryResult, EventStream } from './types';
import type { ModelConfig } from './sub-agent-registry';
import { db } from '../db/client';
import { queryLogs, agentTraces } from '../db/schema';
import { getQuerySettings } from '../settings/effective-config';
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
    private readonly modelConfig?: ModelConfig,
  ) {}

  private buildModelChatOptions(): Pick<ChatOptions, 'model' | 'apiKey' | 'apiUrl' | 'temperature' | 'maxTokens' | 'topK' | 'topP' | 'frequencyPenalty' | 'presencePenalty'> {
    if (!this.modelConfig) return {};
    return {
      model: this.modelConfig.modelId,
      apiKey: this.modelConfig.apiKey,
      apiUrl: this.modelConfig.apiUrl,
      temperature: this.modelConfig.temperature,
      maxTokens: this.modelConfig.maxTokens,
      topK: this.modelConfig.topK,
      topP: this.modelConfig.topP,
      frequencyPenalty: this.modelConfig.frequencyPenalty,
      presencePenalty: this.modelConfig.presencePenalty,
    };
  }

  async execute(query: string, options: QueryOptions, events?: EventStream): Promise<QueryResult> {
    const defaultSystemPrompt = buildSystemPrompt(this.skillRegistry, this.toolRegistry);
    return this.executeWithSystemPrompt(query, options, defaultSystemPrompt, events);
  }

  async executeWithSystemPrompt(
    query: string,
    options: QueryOptions,
    systemPrompt: string,
    events?: EventStream,
  ): Promise<QueryResult> {
    const startTime = Date.now();
    const modelInfo = this.modelConfig ? `${this.modelConfig.displayName} (${this.modelConfig.modelId})` : 'default';
    logger.info(`[Agent] 开始执行`, {
      query: query.slice(0, 100),
      model: modelInfo,
      datasetId: options.datasetId?.slice(0, 8),
      historyLen: (options.history ?? []).length,
      temperature: this.modelConfig?.temperature,
      maxTokens: this.modelConfig?.maxTokens,
    });

    const steps: AgentStep[] = [];
    const allToolCalls: ToolCallRecord[] = [];
    const skillResults: SkillResult[] = [];
    const directRetrievalResults: RetrievalResult[] = [];
    let directAnswer: string | null = null;

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...(options.history ?? []),
      { role: 'user', content: query },
    ];

    const allToolDefs = [
      ...this.skillRegistry.toFunctionDefinitions(),
      ...this.toolRegistry.toFunctionDefinitions(),
    ];

    const maxIterations = options.maxIterations ?? getQuerySettings().agentMaxIterations;
    let skillDone = false;

    for (let iter = 0; iter < maxIterations && !skillDone; iter++) {
      const iterStart = Date.now();
      logger.debug(`[Agent] 迭代 ${iter + 1}/${maxIterations}`, {
        model: modelInfo,
        messagesCount: messages.length,
        toolsCount: allToolDefs.length,
      });

      const llmOpts: ChatOptions = {
        messages,
        tools: allToolDefs,
        tool_choice: 'auto',
        ...this.buildModelChatOptions(),
      };

      const response = await this.streamOrChat(llmOpts, events);
      const iterElapsed = Date.now() - iterStart;

      if (!response.tool_calls?.length) {
        directAnswer = response.content ?? '';
        const contentLen = directAnswer.length;
        logger.info(`[Agent] 迭代 ${iter + 1} → 直接回答 (${iterElapsed}ms)`, {
          contentLen,
          content: directAnswer.slice(0, 200),
        });
        steps.push({ iteration: iter, thought: '直接回答', action: 'answer', params: {}, resultSummary: directAnswer.slice(0, 200) });
        break;
      }

      const toolNames = response.tool_calls.map(tc => tc.function.name).join(', ');
      logger.info(`[Agent] 迭代 ${iter + 1} → 请求工具调用 (${iterElapsed}ms)`, {
        tools: toolNames,
        count: response.tool_calls.length,
      });

      messages.push({ role: 'assistant', content: response.content ?? '', tool_calls: response.tool_calls });

      for (const call of response.tool_calls) {
        const name = call.function.name;
        let params: Record<string, unknown>;
        try { params = JSON.parse(call.function.arguments); } catch { params = {}; }

        const kind = this.skillRegistry.has(name) ? 'skill' : 'tool';
        steps.push({ iteration: iter, thought: response.content ?? '', action: name, params, resultSummary: '' });

        events?.emit({ type: 'tool_call_start', name, kind });
        const callStart = Date.now();
        const result = await this.executeCallable(name, params, options, events);
        const callElapsed = Date.now() - callStart;
        allToolCalls.push({ name, kind, params });

        const retrievalDetails = drainRetrievalDetails();
        if (retrievalDetails.length > 0) {
          steps[steps.length - 1]!.retrievalDetails = retrievalDetails;
        }

        if (this.isSkillResult(result)) {
          skillResults.push(result);
          const summary = this.summarizeSkillResult(name, result);
          logger.info(`[Agent] ${kind} ${name} 返回结果 (${callElapsed}ms)`, {
            kind,
            answerLen: result.answer.length,
            citations: result.citations.length,
            toolCalls: result.toolCalls.map(tc => tc.name).join(',') || '(none)',
          });
          messages.push({ role: 'tool', tool_call_id: call.id, content: summary });
          steps[steps.length - 1]!.resultSummary = summary;
          events?.emit({ type: 'tool_call_end', name, summary });
          skillDone = true;
          break;
        } else {
          if (Array.isArray(result) && result.length > 0 && this.isRetrievalResult(result[0])) {
            directRetrievalResults.push(...(result as RetrievalResult[]));
          }
          const toolContent = this.formatToolResult(result);
          const resultSummary = toolContent.slice(0, 80);
          logger.info(`[Agent] ${kind} ${name} 返回结果 (${callElapsed}ms)`, {
            kind,
            resultLen: toolContent.length,
            summary: resultSummary,
          });
          messages.push({ role: 'tool', tool_call_id: call.id, content: toolContent });
          steps[steps.length - 1]!.resultSummary = toolContent.slice(0, 200);
          events?.emit({ type: 'tool_call_end', name, summary: resultSummary });
        }
      }
    }

    const { answer, citations, termination } = await this.resolveFinalAnswer(
      query, messages, skillResults, directRetrievalResults, directAnswer, options, events,
    );
    const latencyMs = Date.now() - startTime;
    logger.info(`[Agent] 任务完成`, {
      elapsed: `${latencyMs}ms`,
      termination,
      iterations: steps.length,
      toolCalls: allToolCalls.map(tc => tc.name).join(',') || '(none)',
      answerLen: answer.length,
      citations: citations.length,
    });
    const queryLogId = await this.logQuery(query, answer, citations, allToolCalls, steps, latencyMs, options);

    events?.emit({ type: 'result_end', citations, latencyMs, termination, queryLogId });

    return { answer, citations, steps, toolCalls: allToolCalls, latencyMs, queryLogId, termination };
  }

  private async streamOrChat(opts: ChatOptions, events?: EventStream): Promise<ChatResponse> {
    const streamStart = Date.now();
    const modelInfo = opts.model ?? 'default';

    if (!events) {
      const result = await this.llm.chat(opts);
      logger.debug(`[Agent:LLM] chat 完成 (${Date.now() - streamStart}ms)`, {
        model: modelInfo,
        contentLen: result.content?.length ?? 0,
        toolCalls: result.tool_calls?.length ?? 0,
      });
      return result;
    }

    events.emit({ type: 'thinking_start' });
    const tokenBuffer: string[] = [];
    let toolCalls: ToolCall[] | undefined;

    for await (const chunk of this.llm.chatStream(opts)) {
      if (chunk.type === 'token') {
        tokenBuffer.push(chunk.content);
        events.emit({ type: 'thinking_token', token: chunk.content });
      } else if (chunk.type === 'done') {
        toolCalls = chunk.tool_calls;
      }
    }

    const elapsed = Date.now() - streamStart;
    const decision = toolCalls?.length
      ? `工具调用: ${toolCalls.map(tc => tc.function.name).join(',')}`
      : '直接回答';
    logger.info(`[Agent:LLM] stream 完成 (${elapsed}ms)`, {
      model: modelInfo,
      tokens: tokenBuffer.length,
      decision,
    });

    events.emit({ type: 'thinking_end' });

    return { content: tokenBuffer.join('') || null, tool_calls: toolCalls };
  }

  private async resolveFinalAnswer(
    query: string, messages: Message[], skillResults: SkillResult[], directRetrievalResults: RetrievalResult[], directAnswer: string | null, _options: QueryOptions, events?: EventStream,
  ): Promise<{ answer: string; citations: Citation[]; termination: 'skill' | 'synthesis' | 'direct' }> {
    if (skillResults.length > 0) {
      const lastSkill = skillResults[skillResults.length - 1]!;
      const allCitations = skillResults.flatMap(sr => sr.citations);
      logger.info(`[Agent] 终止路径: skill`, {
        skillName: lastSkill.answer.slice(0, 50),
        answerLen: lastSkill.answer.length,
        citations: allCitations.length,
      });

      return { answer: lastSkill.answer, citations: deduplicateCitations(allCitations), termination: 'skill' };
    }
    const fallbackCitations = deduplicateCitations(formatCitations(deduplicateChunks(directRetrievalResults)));
    if (directAnswer !== null) {
      logger.info(`[Agent] 终止路径: direct`, {
        answerLen: directAnswer.length,
        citations: fallbackCitations.length,
      });
      return { answer: directAnswer, citations: fallbackCitations, termination: 'direct' };
    }

    logger.info(`[Agent] 终止路径: synthesis`, { messagesCount: messages.length });

    if (events) {
      events.emit({ type: 'answer_start' });

      const tokenBuffer: string[] = [];
      const synthStart = Date.now();
      for await (const chunk of this.llm.chatStream({ messages: [...messages, { role: 'user', content: SYNTHESIS_FINAL_HINT }], ...this.buildModelChatOptions() })) {
        if (chunk.type === 'token' && chunk.content) {
          tokenBuffer.push(chunk.content);
          events.emit({ type: 'answer_token', token: chunk.content });
        }
      }
      logger.debug(`[Agent:LLM] synthesis 完成 (${Date.now() - synthStart}ms)`, { answerLen: tokenBuffer.join('').length });

      events.emit({ type: 'answer_end' });
      return { answer: tokenBuffer.join('') || '（无法生成回答）', citations: fallbackCitations, termination: 'synthesis' };
    }

    const finalResponse = await this.llm.chat({ messages: [...messages, { role: 'user', content: SYNTHESIS_FINAL_HINT }], ...this.buildModelChatOptions() });
    return { answer: finalResponse.content ?? '（无法生成回答）', citations: fallbackCitations, termination: 'synthesis' };
  }

  private isSkillResult(result: unknown): result is SkillResult {
    return typeof result === 'object' && result !== null && 'answer' in result && 'toolCalls' in result;
  }

  private isRetrievalResult(item: unknown): boolean {
    return typeof item === 'object' && item !== null && 'chunkId' in item && 'text' in item && 'score' in item;
  }

  private summarizeSkillResult(name: string, result: SkillResult): string {
    return `Skill "${name}" 已完成。答案长度: ${result.answer.length} 字符，引用数: ${result.citations.length}。\n答案已由系统收集，你不需要重新生成。`;
  }

  private formatToolResult(result: unknown): string {
    const json = JSON.stringify(result);
    return json.length <= 4000 ? json : json.slice(0, 4000) + '\n[...结果已截断...]';
  }

  private async executeCallable(name: string, params: Record<string, unknown>, options: QueryOptions, events?: EventStream): Promise<unknown> {
    const beforeResult = await this.hookRegistry.runBefore(name, params, { datasetId: options.datasetId, userId: options.userId }).catch(err => { logger.warn(`[Hook before] ${name} threw`, err); return undefined; });
    if (beforeResult?.block) return { error: beforeResult.reason ?? 'blocked by hook' };

    const effectiveDatasetIds = options.datasetIds && options.datasetIds.length > 0
      ? options.datasetIds
      : [options.datasetId];
    const toolCtx = { datasetId: effectiveDatasetIds[0] ?? options.datasetId, datasetIds: effectiveDatasetIds, userId: options.userId, events };

    const skill = this.skillRegistry.get(name);
    let result: unknown;
    if (skill) {
      const ctx = this.buildSkillContext(params, options, events);
      const executor = new SkillExecutor();
      try { result = await executor.execute(skill.instructions, skill.metadata.tools, ctx); } catch (err) { logger.error(`[Skill ${name}] failed`, err); result = { error: `Skill ${name} failed: ${err instanceof Error ? err.message : String(err)}` }; }
    } else {
      const tool = this.toolRegistry.get(name);
      if (!tool) return { error: `Unknown callable: ${name}` };
      try { result = await tool.execute(params, toolCtx); } catch (err) { logger.error(`[Tool ${name}] failed`, err); result = { error: `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}` }; }
    }

    try { const afterResult = await this.hookRegistry.runAfter(name, result, { datasetId: options.datasetId, userId: options.userId }); if (afterResult !== undefined) result = afterResult; } catch (err) { logger.warn(`[Hook after] ${name} threw`, err); }
    return result;
  }

  private buildSkillContext(params: Record<string, unknown>, options: QueryOptions, events?: EventStream): SkillContext {
    const self = this;
    const effectiveDatasetIds = options.datasetIds && options.datasetIds.length > 0
      ? options.datasetIds
      : [options.datasetId];
    return {
      params, datasetId: effectiveDatasetIds[0] ?? options.datasetId, userId: options.userId, history: options.history,
      tools: this.toolRegistry, llm: this.llm, hooks: this.hookRegistry, events, datasetIds: effectiveDatasetIds,
      async executeTool(name, toolParams) { return self.executeCallable(name, toolParams, options, events); },
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
