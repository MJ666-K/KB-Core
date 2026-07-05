import { getSubAgentRegistry } from '../agent/sub-agent-registry';
import type { Tool, ToolContext } from './types';
import type { SkillResult } from '../skills/types';
import type { AgentEvent, EventStream } from '../agent/types';
import { logger } from '../utils/logger';

interface CallAgentParams {
  agent_name: string;
  question: string;
  top_k?: number;
  max_iterations?: number;
  [key: string]: unknown;
}

export const callAgentTool: Tool<CallAgentParams, SkillResult | { error: string }> = {
  name: 'call_agent',
  description: '调用指定领域的子智能体处理用户问题。子智能体会基于自己的专业领域和对应数据集进行检索和回答。当用户问题需要特定领域专业知识时使用。',
  parameters: {
    type: 'object',
    properties: {
      agent_name: {
        type: 'string',
        description: '目标子智能体的唯一标识（从可用智能体列表中选择）',
      },
      question: {
        type: 'string',
        description: '要转给子智能体的问题（基于用户原始问题进行改写优化）',
      },
      top_k: {
        type: 'number',
        description: '检索返回的文档块数量，默认 5',
      },
      max_iterations: {
        type: 'number',
        description: '最大迭代轮数，默认 5',
      },
    },
    required: ['agent_name', 'question'],
  },
  async execute(params: CallAgentParams, ctx: ToolContext): Promise<SkillResult | { error: string }> {
    const callStart = Date.now();
    const registry = getSubAgentRegistry();
    const instance = registry.get(params.agent_name);
    if (!instance) {
      const available = registry.listMetadata().map(m => m.name).join(', ');
      logger.warn(`[call_agent] 找不到目标智能体 ${params.agent_name}`, { available });
      return { error: `Unknown agent: ${params.agent_name}. Available agents: ${available || 'none'}` };
    }

    const { metadata, agent } = instance;
    const datasetIds = metadata.datasetIds ?? [];
    const primaryDatasetId = datasetIds[0] ?? '';

    if (!primaryDatasetId) {
      logger.warn(`[call_agent] 智能体 ${params.agent_name} 没有配置数据集`);
      return { error: `Agent "${params.agent_name}" has no configured datasets` };
    }

    logger.info(`[call_agent] 路由到子智能体`, {
      target: params.agent_name,
      displayName: metadata.displayName,
      model: metadata.model.displayName,
      modelId: metadata.model.modelId,
      question: params.question.slice(0, 100),
      datasetIds: datasetIds.map(id => id.slice(0, 8)),
      topK: params.top_k,
      maxIterations: params.max_iterations,
    });

    const parentEvents = ctx.events;
    let subAgentEvents: EventStream | undefined;
    if (parentEvents) {
      const subAgent = { name: metadata.name, displayName: metadata.displayName };
      subAgentEvents = {
        emit(event: AgentEvent) {
          if (event.type === 'answer_start' || event.type === 'answer_token' || event.type === 'answer_end') {
            parentEvents.emit(event);
          } else {
            parentEvents.emit({ ...event, subAgent } as AgentEvent);
          }
        },
      };
    }

    try {
      const result = await agent.execute(params.question, {
        datasetId: primaryDatasetId,
        datasetIds,
        topK: params.top_k,
        maxIterations: params.max_iterations,
        generateFollowUps: false,
      }, subAgentEvents);
      const elapsed = Date.now() - callStart;

      logger.info(`[call_agent] 子智能体返回`, {
        target: params.agent_name,
        elapsed: `${elapsed}ms`,
        answerLen: result.answer.length,
        citations: result.citations.length,
        toolCalls: result.toolCalls.map(tc => tc.name).join(','),
      });
      return {
        answer: result.answer,
        citations: result.citations,
        toolCalls: result.toolCalls,
      };
    } catch (err) {
      const elapsed = Date.now() - callStart;
      logger.error(`[call_agent] 子智能体失败 (${elapsed}ms)`, { target: params.agent_name, error: err });
      return { error: `Agent ${params.agent_name} failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
