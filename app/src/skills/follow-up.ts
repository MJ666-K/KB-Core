import type { LLMService } from '../llm/llm-service';
import type { HookRegistry } from '../hooks/registry';
import type { ToolRegistry } from '../tools/registry';
import type { SkillRegistry } from './registry';
import { SkillExecutor } from './executor';
import { buildSkillSystemPrompt } from './types';
import type { QueryOptions } from '../agent/types';
import type { Citation } from '../db/schema';
import { logger } from '../utils/logger';

/** 不参与主 Agent 路由的内部 Skill */
export const INTERNAL_SKILL_NAMES = new Set(['followups']);

export const FOLLOWUP_SKILL_NAME = 'followups';

export function isInternalSkill(name: string): boolean {
  return INTERNAL_SKILL_NAMES.has(name);
}

export function parseFollowUpQuestions(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).slice(0, 4);
      }
      if (parsed && typeof parsed === 'object' && 'questions' in parsed) {
        const qs = (parsed as { questions: unknown }).questions;
        if (Array.isArray(qs)) {
          return qs.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).slice(0, 4);
        }
      }
    } catch {
      /* fall through */
    }
  }

  return trimmed
    .split('\n')
    .map(line => line.replace(/^[\d\-*.\s]+/, '').trim())
    .filter(line => line.length > 4 && (line.endsWith('？') || line.endsWith('?')))
    .slice(0, 4);
}

function formatFollowUpParams(params: Record<string, unknown>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n');
}

async function generateFollowUpViaChat(
  llm: LLMService,
  instructions: string,
  params: Record<string, unknown>,
): Promise<string[]> {
  const response = await llm.chat({
    messages: [
      { role: 'system', content: buildSkillSystemPrompt(instructions) },
      { role: 'user', content: formatFollowUpParams(params) },
    ],
    temperature: 0.4,
    maxTokens: 512,
  });
  return parseFollowUpQuestions(response.content ?? '');
}

export async function generateFollowUpQuestions(
  deps: {
    skillRegistry: SkillRegistry;
    toolRegistry: ToolRegistry;
    llm: LLMService;
    hookRegistry: HookRegistry;
    executeCallable: (name: string, params: Record<string, unknown>, options: QueryOptions) => Promise<unknown>;
  },
  input: { query: string; answer: string; citations: Citation[] },
  options: QueryOptions,
): Promise<string[]> {
  const skill = deps.skillRegistry.get(FOLLOWUP_SKILL_NAME);
  if (!skill) {
    logger.debug('[FollowUp] skill not found, skip');
    return [];
  }

  const titles = [...new Set(input.citations.map(c => c.documentTitle).filter(Boolean))];
  const params = {
    query: input.query,
    answer: input.answer.slice(0, 3000),
    document_titles: titles.join('、'),
  };

  try {
    const start = Date.now();
    // 内部 followups 固定走轻量路径，避免 SkillExecutor 触发检索拖慢响应
    const allowedTools = skill.metadata.name === FOLLOWUP_SKILL_NAME ? [] : skill.metadata.tools;
    let questions: string[];

    if (allowedTools.length === 0) {
      questions = await generateFollowUpViaChat(deps.llm, skill.instructions, params);
    } else {
      const effectiveDatasetIds = options.datasetIds && options.datasetIds.length > 0
        ? options.datasetIds
        : [options.datasetId];

      const ctx = {
        params,
        datasetId: effectiveDatasetIds[0] ?? options.datasetId,
        datasetIds: effectiveDatasetIds,
        userId: options.userId,
        history: options.history,
        tools: deps.toolRegistry,
        llm: deps.llm,
        hooks: deps.hookRegistry,
        events: undefined,
        async executeTool(name: string, toolParams: Record<string, unknown>) {
          return deps.executeCallable(name, toolParams, options);
        },
      };

      const executor = new SkillExecutor();
      const result = await executor.execute(skill.instructions, allowedTools, ctx);
      questions = parseFollowUpQuestions(result.answer);
    }

    logger.info('[FollowUp] generated', { count: questions.length, elapsed: `${Date.now() - start}ms` });
    return questions;
  } catch (err) {
    logger.warn('[FollowUp] generation failed', err);
    return [];
  }
}
