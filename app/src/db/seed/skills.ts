import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { db } from '../client';
import { skillDefinitions } from '../schema';
import { parse as parseYaml } from 'yaml';
import { logger } from '../../utils/logger';

const SKILLS_DIR = join(import.meta.dir, '..', '..', 'skills');

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

  return {
    name: front.name,
    displayName: SKILL_DISPLAY_NAMES[front.name] ?? front.name,
    description: front.description,
    tools: front.tools ?? [],
    parameters: (front.parameters ?? { type: 'object', properties: {}, required: [] }) as Record<string, unknown>,
    instructions: match[2]!.trim(),
  };
}

/** 从 skills 目录下的 SKILL.md 同步到 DB（幂等，不覆盖已有配置） */
export async function seedSkillsFromFiles(): Promise<number> {
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

  logger.info(`[Seed] skills synced from files (${inserted} new)`);
  return inserted;
}
