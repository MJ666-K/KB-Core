import type { Skill, SkillMetadata } from './types';
import type { FunctionDefinition } from '../llm/llm-service';
import { SkillLoader } from './loader';
import { isInternalSkill } from './follow-up';

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  register(skill: Skill): void {
    this.skills.set(skill.metadata.name, skill);
  }

  get(name: string): Skill | undefined { return this.skills.get(name); }
  has(name: string): boolean { return this.skills.has(name); }

  toFunctionDefinitions(whitelist?: readonly string[]): FunctionDefinition[] {
    const list = whitelist && whitelist.length > 0
      ? [...this.skills.values()].filter(s => whitelist.includes(s.metadata.name))
      : [...this.skills.values()];
    return list
      .filter(s => !isInternalSkill(s.metadata.name))
      .map(s => ({
        type: 'function' as const,
        function: { name: s.metadata.name, description: s.metadata.description, parameters: s.metadata.parameters },
      }));
  }

  listMetadata(whitelist?: readonly string[]): SkillMetadata[] {
    const list = whitelist && whitelist.length > 0
      ? [...this.skills.values()].filter(s => whitelist.includes(s.metadata.name))
      : [...this.skills.values()];
    return list
      .filter(s => !isInternalSkill(s.metadata.name))
      .map(s => s.metadata);
  }

  /** 重新从 DB 加载所有 skills（覆盖已有） */
  async reload(): Promise<void> {
    this.skills.clear();
    const loader = new SkillLoader();
    const map = await loader.loadAll();
    for (const skill of map.values()) {
      this.register(skill);
    }
  }
}

export async function createSkillRegistry(): Promise<SkillRegistry> {
  const registry = new SkillRegistry();
  await registry.reload();
  return registry;
}
