import type { Skill, SkillMetadata } from './types';
import type { FunctionDefinition } from '../llm/llm-service';
import { SkillLoader } from './loader';

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  /** 手动注册（兼容旧接口，但推荐用 loadFromDir） */
  register(skill: Skill): void {
    if (this.skills.has(skill.metadata.name)) {
      throw new Error(`Skill already registered: ${skill.metadata.name}`);
    }
    this.skills.set(skill.metadata.name, skill);
  }

  get(name: string): Skill | undefined { return this.skills.get(name); }
  has(name: string): boolean { return this.skills.has(name); }

  toFunctionDefinitions(): FunctionDefinition[] {
    return [...this.skills.values()].map(s => ({
      type: 'function' as const,
      function: { name: s.metadata.name, description: s.metadata.description, parameters: s.metadata.parameters },
    }));
  }

  listMetadata(): SkillMetadata[] {
    return [...this.skills.values()].map(s => s.metadata);
  }
}

/**
 * 创建 SkillRegistry 并从 src/skills/ 目录动态加载所有 Skill。
 * SKILL.md 是唯一真相（metadata），index.ts 提供执行逻辑。
 */
export async function createSkillRegistry(skillsBaseDir: string): Promise<SkillRegistry> {
  const loader = new SkillLoader(skillsBaseDir);
  const skillMap = await loader.loadAll();
  const registry = new SkillRegistry();
  for (const skill of skillMap.values()) {
    registry.register(skill);
  }
  return registry;
}
