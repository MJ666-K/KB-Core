import { db } from '@core/db/client';
import { agents, models } from '@core/db/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '@core/utils/logger';
import type { QueryAgent } from './query-agent';

export interface ModelConfig {
  id: string;
  name: string;
  displayName: string;
  provider: string;
  modelId: string;
  apiUrl: string | null;
  apiKey: string | null;
  temperature: number;
  maxTokens: number;
  topK: number | null;
  topP: number | null;
  frequencyPenalty: number | null;
  presencePenalty: number | null;
}

export interface AgentMetadata {
  id: string;
  name: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  modelId: string;
  model: ModelConfig;
  datasetIds: string[];
  skillNames: string[];
  personality: string | null;
  enabled: boolean;
}

export interface SubAgentInstance {
  metadata: AgentMetadata;
  agent: QueryAgent;
}

export class SubAgentRegistry {
  private readonly instances = new Map<string, SubAgentInstance>();
  private factory: ((agentMeta: AgentMetadata) => QueryAgent) | null = null;

  setFactory(factory: (agentMeta: AgentMetadata) => QueryAgent): void {
    this.factory = factory;
  }

  get(name: string): SubAgentInstance | undefined {
    return this.instances.get(name);
  }

  has(name: string): boolean {
    return this.instances.has(name);
  }

  listMetadata(): AgentMetadata[] {
    return [...this.instances.values()].map(i => i.metadata);
  }

  async reload(): Promise<void> {
    if (!this.factory) {
      logger.warn('[SubAgentRegistry] no factory set, skipping reload');
      return;
    }

    this.instances.clear();

    const rows = await db
      .select()
      .from(agents)
      .innerJoin(models, eq(agents.modelId, models.id))
      .where(eq(agents.enabled, true));
    let loaded = 0;

    for (const { agents: agentRow, models: modelRow } of rows) {
      const model: ModelConfig = {
        id: modelRow.id,
        name: modelRow.name,
        displayName: modelRow.displayName,
        provider: modelRow.provider,
        modelId: modelRow.modelId,
        apiUrl: modelRow.apiUrl,
        apiKey: modelRow.apiKey,
        temperature: modelRow.temperature,
        maxTokens: modelRow.maxTokens,
        topK: modelRow.topK,
        topP: modelRow.topP,
        frequencyPenalty: modelRow.frequencyPenalty,
        presencePenalty: modelRow.presencePenalty,
      };

      const meta: AgentMetadata = {
        id: agentRow.id,
        name: agentRow.name,
        displayName: agentRow.displayName,
        description: agentRow.description,
        systemPrompt: agentRow.systemPrompt,
        modelId: agentRow.modelId,
        model,
        datasetIds: agentRow.datasetIds ?? [],
        skillNames: agentRow.skillNames ?? [],
        personality: agentRow.personality ?? null,
        enabled: agentRow.enabled,
      };
      try {
        const agent = this.factory(meta);
        this.instances.set(meta.name, { metadata: meta, agent });
        loaded++;
      } catch (err) {
        logger.error(`[SubAgentRegistry] failed to build agent "${meta.name}"`, err);
      }
    }

    logger.info(`[SubAgentRegistry] loaded ${loaded} sub-agents: ${[...this.instances.keys()].join(', ')}`);
  }
}

let registryInstance: SubAgentRegistry | null = null;

export function getSubAgentRegistry(): SubAgentRegistry {
  if (!registryInstance) registryInstance = new SubAgentRegistry();
  return registryInstance;
}

export function setSubAgentRegistry(r: SubAgentRegistry): void {
  registryInstance = r;
}
