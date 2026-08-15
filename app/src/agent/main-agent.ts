import type { LLMService } from '../llm/llm-service';
import type { SkillRegistry } from '../skills/registry';
import type { ToolRegistry } from '../tools/registry';
import type { HookRegistry } from '../hooks/registry';
import { QueryAgent } from './query-agent';
import { getSubAgentRegistry } from './sub-agent-registry';
import { buildSystemPrompt } from './system-prompt';
import type { QueryOptions, QueryResult, EventStream } from './types';
import type { ModelConfig } from './sub-agent-registry';
import type { Citation } from '../db/schema';
import { config } from '../config';
import { logger } from '../utils/logger';
import { generateFollowUpQuestions } from '../skills/follow-up';
import { inferFengqiaoRoute, META_TOOL } from './fengqiao-router';
import { sanitizeUserFacingAnswer } from '../utils/sanitize-answer';
import type { SkillResult } from '../skills/types';
import type { ToolCallRecord, AgentStep } from '../db/schema';

export class MainAgent {
  private readonly mainModelConfig: ModelConfig;

  constructor(
    private readonly llm: LLMService,
    private readonly skillRegistry: SkillRegistry,
    private readonly toolRegistry: ToolRegistry,
    private readonly hookRegistry: HookRegistry,
  ) {
    this.mainModelConfig = {
      id: 'main',
      name: config.llmModelId,
      displayName: '主调度',
      provider: 'env',
      modelId: config.llmModelId,
      apiUrl: config.llmApiUrl,
      apiKey: config.llmApiKey,
      temperature: 0.2,
      maxTokens: 4096,
      topK: null,
      topP: null,
      frequencyPenalty: null,
      presencePenalty: null,
    };
  }

  async execute(query: string, options: QueryOptions, events?: EventStream): Promise<QueryResult> {
    const subAgents = getSubAgentRegistry().listMetadata();
    const hasSubAgents = subAgents.length > 0;

    const ruleRoute = hasSubAgents ? inferFengqiaoRoute(query) : null;

    if (hasSubAgents && META_TOOL.test(query.trim())) {
      const safeAnswer = '我根据法律知识库和法律法规资料为您解答，不会在回复中展示系统内部的技术细节或工具名称。如有具体法律问题，请直接提问，我会为您分析。';
      return {
        answer: safeAnswer,
        citations: [],
        steps: [{ iteration: 0, thought: '系统元问题', action: 'direct', params: {}, resultSummary: safeAnswer }],
        toolCalls: [],
        latencyMs: 0,
        queryLogId: '',
        termination: 'direct',
      };
    }

    if (ruleRoute) {
      const callAgent = this.toolRegistry.get('call_agent');
      if (callAgent) {
        const start = Date.now();
        logger.info('[MainAgent] 规则路由', { route: ruleRoute, question: query.slice(0, 80) });
        events?.emit({ type: 'tool_call_start', name: 'call_agent', kind: 'tool' });
        const result = await callAgent.execute(
          { agent_name: ruleRoute, question: query },
          { datasetId: options.datasetId, datasetIds: options.datasetIds, userId: options.userId, events },
        );
        events?.emit({ type: 'tool_call_end', name: 'call_agent' });
        const elapsed = Date.now() - start;

        if (result && typeof result === 'object' && 'answer' in result && !('error' in result)) {
          const skillResult = result as SkillResult;
          const steps: AgentStep[] = [{
            iteration: 0,
            thought: `规则路由 → ${ruleRoute}`,
            action: 'call_agent',
            params: { agent_name: ruleRoute, question: query },
            resultSummary: skillResult.answer.slice(0, 200),
          }];
          const toolCalls: ToolCallRecord[] = [{
            name: 'call_agent',
            kind: 'tool',
            params: { agent_name: ruleRoute, question: query },
            latencyMs: elapsed,
          }];
          return {
            answer: sanitizeUserFacingAnswer(skillResult.answer),
            citations: skillResult.citations,
            steps,
            toolCalls: [...toolCalls, ...skillResult.toolCalls],
            latencyMs: elapsed,
            queryLogId: '',
            termination: 'skill',
          };
        }
        logger.warn('[MainAgent] 规则路由 call_agent 失败，回退 LLM 调度', { route: ruleRoute, result });
      }
    }

    const systemPrompt = buildSystemPrompt(
      this.skillRegistry,
      this.toolRegistry,
      hasSubAgents ? { subAgents } : {},
    );
    logger.info(`[MainAgent] 调度开始`, {
      model: this.mainModelConfig.displayName,
      modelId: this.mainModelConfig.modelId,
      subAgents: subAgents.map(a => a.name).join(', ') || '(none)',
    });
    const delegate = new QueryAgent(this.llm, this.skillRegistry, this.toolRegistry, this.hookRegistry, this.mainModelConfig);
    return delegate.executeWithSystemPrompt(query, options, systemPrompt, events);
  }

  /** 主 Agent 回答完成后异步生成推荐追问（不阻塞 result） */
  async generateFollowUpSuggestions(
    query: string,
    answerResult: { answer: string; citations: Citation[] },
    options: QueryOptions,
  ): Promise<string[]> {
    if (!answerResult.answer.trim()) return [];

    const start = Date.now();
    const questions = await generateFollowUpQuestions(
      {
        skillRegistry: this.skillRegistry,
        toolRegistry: this.toolRegistry,
        llm: this.llm,
        hookRegistry: this.hookRegistry,
        executeCallable: async () => ({ error: 'follow-up skill does not use tools' }),
      },
      { query, answer: answerResult.answer, citations: answerResult.citations },
      options,
    );
    logger.info('[MainAgent] follow-up suggestions', { count: questions.length, elapsed: `${Date.now() - start}ms` });
    return questions;
  }
}
