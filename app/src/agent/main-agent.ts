import type { LLMService } from '../llm/llm-service';
import type { SkillRegistry } from '../skills/registry';
import type { ToolRegistry } from '../tools/registry';
import type { HookRegistry } from '../hooks/registry';
import { QueryAgent } from './query-agent';
import { getSubAgentRegistry } from './sub-agent-registry';
import { buildSystemPrompt } from './system-prompt';
import type { QueryOptions, QueryResult, EventStream } from './types';
import type { ModelConfig } from './sub-agent-registry';
import { config } from '../config';
import { logger } from '../utils/logger';

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
}
