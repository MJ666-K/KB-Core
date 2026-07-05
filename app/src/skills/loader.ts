import { db } from '../db/client';
import { skillDefinitions } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import type { Skill, SkillMetadata } from './types';
import type { JSONSchemaProperty } from '../tools/types';
import { logger } from '../utils/logger';
import { seedSkills } from '../db/seed';

export class SkillLoader {
  /**
   * 从 DB 加载所有 enabled skills。
   * 如 DB 为空，触发 seedSkills() 自动迁移文件 SKILL.md → DB。
   * 不再有文件兜底——DB 是唯一真相。
   */
  async loadAll(): Promise<Map<string, Skill>> {
    const rows = await db.select().from(skillDefinitions)
      .where(eq(skillDefinitions.enabled, true))
      .orderBy(asc(skillDefinitions.name));

    if (rows.length === 0) {
      logger.info('[SkillLoader] DB empty, seeding from files');
      await seedSkills();
      const seeded = await db.select().from(skillDefinitions)
        .where(eq(skillDefinitions.enabled, true));
      return this.rowsToMap(seeded);
    }

    return this.rowsToMap(rows);
  }

  private rowsToMap(rows: Array<typeof skillDefinitions.$inferSelect>): Map<string, Skill> {
    const skills = new Map<string, Skill>();
    for (const row of rows) {
      try {
        const metadata: SkillMetadata = {
          name: row.name,
          description: row.description,
          tools: row.tools ?? [],
          parameters: this.normalizeParameters(row.parameters),
        };
        skills.set(row.name, { metadata, instructions: row.instructions });
      } catch (err) {
        logger.error(`[SkillLoader] failed to build "${row.name}"`, err);
      }
    }
    logger.info(`[SkillLoader] loaded ${skills.size} skills: ${[...skills.keys()].join(', ')}`);
    return skills;
  }

  private normalizeParameters(params: unknown): SkillMetadata['parameters'] {
    if (!params || typeof params !== 'object') {
      return { type: 'object', properties: {}, required: [] };
    }
    const p = params as { type?: string; properties?: Record<string, unknown>; required?: string[] };
    return {
      type: 'object',
      properties: (p.properties ?? {}) as Record<string, JSONSchemaProperty>,
      required: p.required ?? [],
    };
  }
}
