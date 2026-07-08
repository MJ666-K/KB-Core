# 变更日志：回答输出优先可视化表达

**日期**：2026-07-09
**项目缩写**：core
**类型**：功能改进

## 变更摘要

Skill 与 Agent 合成回答时，统一要求能用流程图/时序图/表格表达的内容优先用 Mermaid 等可视化形式输出，提升可读性。

## 变更详情

- 在 `OUTPUT_FORMAT_RULES` 中新增「可视化表达」章节：流程/决策用 flowchart，多方交互用 sequenceDiagram，并列对比用表格，可组合使用
- 更新 `RETRIEVAL_FINAL_HINT`、`NO_RETRIEVAL_FINAL_HINT`、`SYNTHESIS_FINAL_HINT`，强调优先出图
- 更新 qa / compare / multihop / summary 的 SKILL.md，补充各场景的可视化策略
- `SkillExecutor` 强制收尾时使用完整 `RETRIEVAL_FINAL_HINT`

## 影响的文件/模块

| 文件/模块 | 变更类型 | 说明 |
|----------|---------|------|
| `app/src/skills/types.ts` | 修改 | 全局输出格式 + 合成提示词 |
| `app/src/agent/query-agent.ts` | 修改 | synthesis 路径使用新提示 |
| `app/src/skills/executor.ts` | 修改 | 强制收尾提示 |
| `app/src/skills/*/SKILL.md` | 修改 | 各 Skill 可视化指引 |

## 验证方式

- [x] `bun run typecheck`（app/）通过
- [ ] 问答页触发 compare / qa / multihop，确认回答含 Mermaid 流程图且前端正常渲染

## 后续工作

- [ ] 若 DB 中 Skill instructions 与 SKILL.md 不一致，可通过管理端更新或重新同步 instructions 字段

---

# 变更日志：Mermaid 流式占位与语法错误修复

**日期**：2026-07-09
**项目缩写**：global
**类型**：Bug 修复

## 变更摘要

流式输出期间 Mermaid 不再提前渲染不完整语法；输出结束后才渲染，失败时显示源码而非炸弹错误 UI。

## 变更详情

- `MarkdownContent` 新增 `streaming`：writing 阶段流程图显示 240px 占位 + 加载动画
- 启用 `suppressErrorRendering`，先 `parse` 再 `render`，失败回退源码
- 自动清理 Mermaid 内 `[1]` 引用等 LLM 常见语法污染

## 影响的文件/模块

| 文件/模块 | 变更类型 | 说明 |
|----------|---------|------|
| `status/src/MarkdownContent.tsx` | 修改 | 流式占位 + 渲染逻辑 |
| `status/src/pages/Chat.tsx` | 修改 | 传递 streaming |
| `status/src/index.css` | 修改 | 占位样式 |
| `app/src/skills/types.ts` | 修改 | 提示词禁止图内引用 |
