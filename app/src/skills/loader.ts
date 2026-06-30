import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { Skill, SkillMetadata } from './types';
import type { JSONSchemaProperty } from '../tools/types';
import { logger } from '../utils/logger';

/**
 * Skill 加载器：从文件系统发现 SKILL.md，解析为 Skill 对象。
 *
 * 每个 Skill 是一个目录，只包含一个 SKILL.md：
 * - YAML frontmatter → SkillMetadata（name, description, tools, parameters）
 * - Markdown 正文   → instructions（LLM 执行指令）
 *
 * 没有代码文件。Skill 的执行完全由 SKILL.md 驱动。
 */
export class SkillLoader {
  constructor(private readonly skillsBaseDir: string) {}

  async loadAll(): Promise<Map<string, Skill>> {
    const skills = new Map<string, Skill>();
    const entries = await readdir(this.skillsBaseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules') continue;

      const skillDir = join(this.skillsBaseDir, entry.name);
      try {
        const skill = await this.loadOne(skillDir, entry.name);
        if (skill) {
          skills.set(skill.metadata.name, skill);
          logger.debug(`[SkillLoader] loaded: ${skill.metadata.name}`);
        }
      } catch (err) {
        logger.error(`[SkillLoader] failed to load "${entry.name}"`, err);
      }
    }

    logger.info(`[SkillLoader] loaded ${skills.size} skills: ${[...skills.keys()].join(', ')}`);
    return skills;
  }

  private async loadOne(skillDir: string, dirName: string): Promise<Skill | null> {
    const skillMdPath = join(skillDir, 'SKILL.md');
    let content: string;
    try {
      content = await readFile(skillMdPath, 'utf-8');
    } catch {
      logger.warn(`[SkillLoader] ${dirName}/SKILL.md not found, skipping`);
      return null;
    }

    const { metadata, body } = parseSkillMd(content, dirName);

    return { metadata, instructions: body };
  }
}

/** 解析 SKILL.md → metadata（frontmatter） + body（正文指令） */
function parseSkillMd(content: string, fallbackName: string): { metadata: SkillMetadata; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match?.[1]) {
    throw new Error(`SKILL.md for "${fallbackName}" has no YAML frontmatter (--- ... ---)`);
  }

  const raw = parseYaml(match[1]) as RawFrontmatter;

  if (!raw.name) throw new Error(`Skill "${fallbackName}": frontmatter missing "name"`);
  if (!raw.description) throw new Error(`Skill "${raw.name}": frontmatter missing "description"`);

  const metadata: SkillMetadata = {
    name: raw.name,
    description: raw.description,
    tools: raw.tools ?? [],
    parameters: normalizeParameters(raw.parameters),
  };

  return { metadata, body: match[2]!.trim() };
}

interface RawFrontmatter {
  name?: string;
  description?: string;
  tools?: string[];
  parameters?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

function normalizeParameters(params: RawFrontmatter['parameters']): SkillMetadata['parameters'] {
  if (!params) return { type: 'object', properties: {}, required: [] };
  return {
    type: 'object',
    properties: (params.properties ?? {}) as Record<string, JSONSchemaProperty>,
    required: params.required ?? [],
  };
}
