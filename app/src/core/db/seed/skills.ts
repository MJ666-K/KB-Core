import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { db } from '../client';
import { skillDefinitions } from '../schema';
import { parse as parseYaml } from 'yaml';
import { logger } from '@core/utils/logger';

/** 三层结构后 Skill 分布在各 feature 下，不再集中于 src/skills */
const SKILL_DIRS = [
  join(import.meta.dir, '../../../features/chat/skills/builtin'),
  join(import.meta.dir, '../../../features/excel/skills'),
];

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
  'mediation-advisor': '调解业务问答',
  excel_analysis: 'Excel 智能分析',
  excel_profiling: 'Excel 数据画像',
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

/** 从各 feature 的 skills 目录同步 SKILL.md 到 DB（幂等，不覆盖已有配置） */
export async function seedSkillsFromFiles(): Promise<number> {
  let inserted = 0;

  for (const skillsDir of SKILL_DIRS) {
    let entries;
    try {
      entries = await readdir(skillsDir, { withFileTypes: true });
    } catch (err) {
      logger.warn(`[Seed] skills dir missing, skip: ${skillsDir}`, err);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      const skill = await parseSkillMdFile(join(skillsDir, entry.name));
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
  }

  logger.info(`[Seed] skills synced from files (${inserted} new)`);
  return inserted;
}
