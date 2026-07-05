import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { db } from './client';
import { skillDefinitions, agents, datasets, models } from './schema';
import { eq, sql } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import { logger } from '../utils/logger';

const SKILLS_DIR = join(import.meta.dir, '..', 'skills');

interface ParsedSkill {
  name: string;
  displayName: string;
  description: string;
  tools: string[];
  parameters: Record<string, unknown>;
  instructions: string;
}

const SKILL_DISPLAY_NAMES: Record<string, string> = {
  chat: '智能回复',
  qa: '法律问答',
  search: '法条检索',
  multihop: '深度分析',
  compare: '对比分析',
  summary: '要点总结',
  followups: '推荐追问',
};

async function parseSkillMdFile(skillDir: string): Promise<ParsedSkill | null> {
  const skillMdPath = join(skillDir, 'SKILL.md');
  let content: string;
  try {
    content = await readFile(skillMdPath, 'utf-8');
  } catch {
    return null;
  }

  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match?.[1]) return null;

  const front = parseYaml(match[1]) as {
    name?: string;
    description?: string;
    tools?: string[];
    parameters?: Record<string, unknown>;
  };

  if (!front.name || !front.description) return null;

  const params = front.parameters ?? { type: 'object', properties: {}, required: [] };

  return {
    name: front.name,
    displayName: SKILL_DISPLAY_NAMES[front.name] ?? front.name,
    description: front.description,
    tools: front.tools ?? [],
    parameters: params as Record<string, unknown>,
    instructions: match[2]!.trim(),
  };
}

export async function seedSkills(): Promise<void> {
  const existing = await db.select({ id: skillDefinitions.id }).from(skillDefinitions).limit(1);
  if (existing.length > 0) {
    logger.info('[Seed] skill_definitions already populated, skipping');
    return;
  }

  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  let inserted = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const skill = await parseSkillMdFile(join(SKILLS_DIR, entry.name));
    if (!skill) continue;

    await db.insert(skillDefinitions).values({
      name: skill.name,
      displayName: skill.displayName,
      description: skill.description,
      tools: skill.tools,
      parameters: skill.parameters,
      instructions: skill.instructions,
    }).onConflictDoNothing();
    inserted++;
  }

  logger.info(`[Seed] inserted ${inserted} skills from files`);
}

/** 将文件系统中尚未入库的 Skill 补写入 DB（不覆盖已有配置） */
export async function ensureMissingSkillsFromFiles(): Promise<number> {
  const existing = await db.select({ name: skillDefinitions.name }).from(skillDefinitions);
  const existingNames = new Set(existing.map(r => r.name));

  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  let inserted = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const skill = await parseSkillMdFile(join(SKILLS_DIR, entry.name));
    if (!skill || existingNames.has(skill.name)) continue;

    await db.insert(skillDefinitions).values({
      name: skill.name,
      displayName: skill.displayName,
      description: skill.description,
      tools: skill.tools,
      parameters: skill.parameters,
      instructions: skill.instructions,
    }).onConflictDoNothing();
    inserted++;
    logger.info(`[Seed] inserted missing skill: ${skill.name}`);
  }

  return inserted;
}

export async function seedAgents(): Promise<void> {
  const [legalDs] = await db.select({ id: datasets.id }).from(datasets).where(eq(datasets.name, 'legal'));
  const allDs = await db.select({ id: datasets.id }).from(datasets);
  const allIds = allDs.map(d => d.id);
  const legalIds = legalDs ? [legalDs.id] : allIds;

  const modelsList = await db.select({ id: models.id, name: models.name }).from(models);
  const modelIds = Object.fromEntries(modelsList.map(m => [m.name, m.id]));

  const presetAgents = [
    {
      name: 'router',
      displayName: '路由智能体',
      description: '快速判断用户意图，分发到对应的领域专家智能体。',
      systemPrompt: '你是路由智能体。根据用户问题快速判断应交给哪个领域专家处理，直接调用对应 agent。',
      modelName: 'qwen-turbo',
      datasetIds: [] as string[],
      skillNames: [] as string[],
      personality: '高效、精准',
    },
    {
      name: 'general',
      displayName: '通用法律助手',
      description: '通用法律知识问答，适用于所有非特定领域的法律问题、法条查询、一般法律咨询。',
      systemPrompt: '你是「通用法律助手」。基于知识库中的法律文档，为用户提供准确的法律问答。回答时精确引用法律名称和条款编号。如果知识库中没有相关内容，诚实说明。',
      modelName: 'qwen-max',
      datasetIds: allIds,
      skillNames: [] as string[],
      personality: '专业、准确、简洁',
    },
    {
      name: 'mediation',
      displayName: '基层调解助手',
      description: '专注于劳动争议、调解仲裁、工伤赔偿、工资福利、劳动合同解除等劳动者权益问题。适用于劳动者与用人单位之间的纠纷咨询。',
      systemPrompt: '你是「基层调解助手」，专门处理劳动者与用人单位之间的纠纷咨询。重点使用《劳动法》《劳动合同法》《劳动争议调解仲裁法》《社会保险法》等。回答时明确引用法条，给出可操作的调解建议。优先保护劳动者合法权益。',
      modelName: 'deepseek-v4-pro',
      datasetIds: legalIds,
      skillNames: [] as string[],
      personality: '温和、耐心、务实',
    },
    {
      name: 'corporate',
      displayName: '企业法务顾问',
      description: '专注于公司法务、合同审查、公司治理、股权架构、合规风控等企业端法律问题。适用于企业经营中的法律风险防范。',
      systemPrompt: '你是「企业法务顾问」，为企业提供合规和公司治理方面的法律建议。重点使用《公司法》《民法典》合同编等。回答时关注企业端的合规要求和风险防范，给出具体的操作建议。注意：你的建议不构成正式法律意见。',
      modelName: 'deepseek-v4-pro',
      datasetIds: legalIds,
      skillNames: [] as string[],
      personality: '严谨、前瞻、风险导向',
    },
    {
      name: 'executor',
      displayName: '工具执行智能体',
      description: '执行具体的工具调用和结果整理，如知识库检索、文档查询、摘要生成等。',
      systemPrompt: '你是工具执行智能体。根据指令执行工具调用，整理并返回结构化结果。',
      modelName: 'qwen-plus',
      datasetIds: allIds,
      skillNames: [] as string[],
      personality: '高效、结构化',
    },
  ];

  for (const a of presetAgents) {
    const modelId = modelIds[a.modelName];
    if (!modelId) {
      logger.warn(`[Seed] Model ${a.modelName} not found, skipping agent ${a.name}`);
      continue;
    }

    await db.insert(agents)
      .values({
        name: a.name,
        displayName: a.displayName,
        description: a.description,
        systemPrompt: a.systemPrompt,
        modelId,
        datasetIds: a.datasetIds,
        skillNames: a.skillNames,
        personality: a.personality,
      })
      .onConflictDoUpdate({
        target: agents.name,
        set: {
          modelId,
          displayName: a.displayName,
          description: a.description,
          systemPrompt: a.systemPrompt,
          datasetIds: a.datasetIds,
          skillNames: a.skillNames,
          personality: a.personality,
          updatedAt: new Date(),
        },
      });
  }

  logger.info(`[Seed] inserted ${presetAgents.length} preset agents`);
}
