import type { SkillRegistry } from '@features/chat/skills/registry';
import type { ToolRegistry } from '@features/kb/tools/registry';
import type { AgentMetadata } from '@features/chat/agent/sub-agent-registry';

export interface BuildPromptOptions {
  customSystemPrompt?: string;
  subAgents?: AgentMetadata[];
  skillWhitelist?: readonly string[];
}

export function buildSystemPrompt(
  skillRegistry: SkillRegistry,
  toolRegistry: ToolRegistry,
  options: BuildPromptOptions = {},
): string {
  if (options.customSystemPrompt) {
    return options.customSystemPrompt + '\n\n' + buildToolDescriptions(skillRegistry, toolRegistry, options);
  }

  if (options.subAgents && options.subAgents.length > 0) {
    return buildMainAgentPrompt(skillRegistry, toolRegistry, options.subAgents);
  }

  return buildDefaultPrompt(skillRegistry, toolRegistry, options);
}

function buildToolDescriptions(
  skillRegistry: SkillRegistry,
  toolRegistry: ToolRegistry,
  options: BuildPromptOptions = {},
): string {
  const skills = skillRegistry.listMetadata(options.skillWhitelist);
  const tools = toolRegistry.list();
  const parts: string[] = [];

  if (skills.length > 0) {
    parts.push(`## Skill（高级任务）\n${skills.map(s => `- **${s.name}**: ${s.description}`).join('\n')}`);
  }
  if (tools.length > 0) {
    parts.push(`## Tool（原子操作）\n${tools.map(t => `- **${t.name}**: ${t.description}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

function buildDefaultPrompt(
  skillRegistry: SkillRegistry,
  toolRegistry: ToolRegistry,
  options: BuildPromptOptions = {},
): string {
  const skills = skillRegistry.listMetadata(options.skillWhitelist);
  const tools = toolRegistry.list();

  return `你是一个知识库 Agent。根据用户问题，自主选择调用 Skill 或 Tool 来回答。

## 你的能力

### Skill（高级任务，推荐优先使用）

每个 Skill 是一个完整的任务流程，会自己检索 + 生成 + 返回带引用的完整答案。

${skills.map(s => `- **${s.name}**: ${s.description}`).join('\n')}

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

function buildMainAgentPrompt(
  skillRegistry: SkillRegistry,
  toolRegistry: ToolRegistry,
  subAgents: AgentMetadata[],
): string {
  return `你是一个法律知识库的主调度智能体。根据用户的问题内容，把它路由到合适的领域子智能体去回答。

## 可用的子智能体

${subAgents.map(a => `- **${a.name}** (${a.displayName}): ${a.description}`).join('\n')}

## 工作方式

1. 分析用户意图和问题领域
2. 选择最合适的子智能体（通过 call_agent 工具调用）
3. 子智能体会基于它自己的专业领域和数据集返回答案
4. **直接把子智能体的答案返回给用户**，你不需要重新生成答案

## 路由决策

- 劳动争议、劳动合同、工资、加班、调解仲裁、工伤 → 使用 ${subAgents.find(a => a.name === 'mediation')?.name ?? 'mediation'}
- 公司法务、合同审查、股权架构、合规风控、公司治理 → 使用 ${subAgents.find(a => a.name === 'corporate')?.name ?? 'corporate'}
- 其他通用法律问题 → 使用 ${subAgents.find(a => a.name === 'general')?.name ?? 'general'}

## 重要

- 子智能体的答案是最终答案，你只需转发
- 如果用户问题不涉及任何特定领域，可以选择通用智能体
- 不要自己生成法律内容，避免与子智能体重复

${buildToolDescriptions(skillRegistry, toolRegistry)}`;
}
