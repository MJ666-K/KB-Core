import type { SkillRegistry } from '../skills/registry';
import type { ToolRegistry } from '../tools/registry';
import type { JSONSchemaProperty } from '../tools/types';

export function buildSystemPrompt(skillRegistry: SkillRegistry, toolRegistry: ToolRegistry): string {
  const skills = skillRegistry.listMetadata();
  const tools = toolRegistry.list();

  return `你是一个知识库 Agent。根据用户问题，自主选择调用 Skill 或 Tool 来回答。

## 你的能力

### Skill（高级任务，推荐优先使用）

每个 Skill 是一个完整的任务流程，会自己检索 + 生成 + 返回带引用的完整答案。

${skills.map(s => `- **${s.name}**: ${s.description}\n  参数: ${formatParams(s.parameters)}`).join('\n')}

### Tool（原子操作）

${tools.map(t => `- **${t.name}**: ${t.description}`).join('\n')}

## 决策原则

1. **Skill 优先**：如果有合适的 Skill，优先调 Skill
2. **Tool 补充**：Skill 不够时，可以补调 Tool
3. **可以组合**：可以调多个 Skill
4. **可以迭代**：第一次不够，可以再调
5. **闲聊直接答**：不需要调任何 Skill/Tool

## 重要

- 调用 Skill 后，Skill 已经返回了完整答案，你不需要重新生成
- 如果你只调了 Tool，系统会帮你做最终合成
- 如果不需要任何 Skill/Tool，直接回复用户即可`;
}

function formatParams(parameters: { properties: Record<string, unknown>; required: readonly string[] }): string {
  const props = Object.entries(parameters.properties);
  if (props.length === 0) return '（无）';
  return props.map(([name, schema]) => {
    const s = schema as { type: string };
    const req = parameters.required.includes(name) ? '必填' : '可选';
    return `${name}(${s.type}, ${req})`;
  }).join(', ');
}
