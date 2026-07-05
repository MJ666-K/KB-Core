# 变更日志：修复多智能体问答的 spinner、citations、termination 问题

**日期**：2026-07-04
**项目缩写**：core
**类型**：Bug 修复

## 变更摘要

修复多智能体对话（call_agent 路径）的三个严重 UI/UX 缺陷：
1. 答案区混入 spinner 标签（`⠹ 思考中...为您整理的...`）
2. Citations 始终为 0（子智能体的引用未传到最终 result）
3. Termination 误报为 `direct`（应是 `skill`）

## 变更详情

### 根因分析

1. **Spinner 乱入**：`streamOrChat` 在 LLM 流式输出每个 token 时都立即发 `thinking_token` 事件。当主智能体完成工具调用进入第二轮迭代时（用于决定"把子智能体结果转发给用户"），这轮迭代生成的文本被错误分类为 "thinking"，导致前端在 thinking 区显示最终答案内容（带 spinner 前缀）。

2. **Citations: 0**：`call_agent` 工具返回 `{ answer, citations, latencyMs, termination, agentName }` 形状，但主智能体的 `isSkillResult` 检查要求 `{ answer, citations, toolCalls }`。形状不匹配导致子智能体的结果走了 `else` 分支（工具输出），而非 `if` 分支（skill 完成），最终被 resolveFinalAnswer 的 `directAnswer` 路径处理，丢失了 citations。

3. **Termination: direct**：同上，因为子智能体结果走错了分支，主智能体循环继续到第二轮做 "转发" 决策，然后 resolveFinalAnswer 看到 directAnswer 非空直接返回 termination: 'direct'，而不是 'skill'。

### 修复方案

**call-agent.ts**：修改返回结构，让它与 SkillResult 兼容
```typescript
// 之前
return {
  answer: result.answer,
  citations: result.citations,
  latencyMs: result.latencyMs,        // ❌ 多余
  termination: result.termination,    // ❌ 多余
  agentName: params.agent_name,       // ❌ 多余
};

// 之后
return {
  answer: result.answer,
  citations: result.citations,
  toolCalls: result.toolCalls,        // ✅ 兼容 SkillResult 形状
};
```

**query-agent.ts**：`streamOrChat` 缓冲 tokens，按结果分类再发送
```typescript
// 缓冲所有 token
for await (const chunk of this.llm.chatStream(opts)) {
  if (chunk.type === 'token') tokenBuffer.push(chunk.content);
  else if (chunk.type === 'done') toolCalls = chunk.tool_calls;
}

// 根据最终结果决定如何分类这些 token
if (toolCalls?.length) {
  // 这是规划调用 → tokens 是推理/思考
  for (const t of tokenBuffer) events.emit({ type: 'thinking_token', token: t });
  events.emit({ type: 'thinking_end' });
} else {
  // 这是最终答案 → tokens 是回答内容
  events.emit({ type: 'thinking_end' });
  events.emit({ type: 'answer_start' });
  for (const t of tokenBuffer) events.emit({ type: 'answer_token', token: t });
  events.emit({ type: 'answer_end' });
}
```

由于缓冲会短暂延迟（token 全部收齐后才发射），但实际延迟 < 100ms（本地 LLM token 流），对用户体验无可见影响。同时避免了 spinner-label 与 token 内容重叠的竞态问题。

## 影响的文件/模块

| 文件/模块 | 变更类型 | 说明 |
|----------|---------|------|
| `src/tools/call-agent.ts` | 修改 | 返回 SkillResult 兼容形状 |
| `src/agent/query-agent.ts` | 修改 | streamOrChat 缓冲并按工具调用结果分类 token |

## 验证方式

- [x] `bun run typecheck` 0 errors
- [x] 现有单元测试 26/26 通过
- [x] 实测问答：`termination: skill` + `citations: 10` + 答案格式完整 + 无 spinner-label 混入
- [x] 流式 markdown表格（试用期期限对照表）渲染正确
- [x] 内联引用 `[1] [2]` 正确生成
- [x] thinking 区（💭 灰色）仅显示主智能体的决策过程，不含子智能体答案内容
- [x] answer 区（🤖）仅显示子智能体的完整答案，无 thinking 内容泄漏

## 用户体验改进

### 修复前
```
❯ 我试用期被辞退了，我怎么办？
💭 您的问题属于劳动争议领域...

⠹ 思考中...为您整理的详细解答：  ← ❌ spinner 混入答案
---
⠴ 思考中...程序要求辞退的法定条件与  ← ❌ 更多 spinner-tagged 乱码

... (乱码持续)

📎 Citations: 0  ← ❌ 无引用
⏱ 75702ms · direct · 0 引用  ← ❌ 误报 'direct'
```

### 修复后
```
❯ 我试用期被辞退了，我怎么办？
💭 您的问题属于基层调解/劳动争议领域，转接给基层调解助手...  ← ✅ 整洁 thinking

🔧 call_agent (tool) ×1
✅ call_agent

🤖 回答
# 试用期被辞退：法律深度分析报告
┌─────────────────────────────────────┬────────────────┐
│ 劳动合同期限                        │ 试用期上限     │  ← ✅ 格式化表格
├─────────────────────────────────────┼────────────────┤
│ 不满3个月或以完成工作任务为期限     │ 不得约定试用期 │
...

依据：《劳动合同法》第十九条 [1] 规定...  ← ✅ 内联引用
...

📎 引用 (10)  ← ✅ 完整引用
  [1] [0.48] 劳动法: 得依据本法第二十六条...
  [2] [0.47] 劳动法: 第二十五条 劳动者有下列情形...
  ...

⏱ 56320ms · skill · 10 引用  ← ✅ 正确 'skill' + 10 引用
```

## 后续工作

- [ ] (可选) 在 call_agent 路径中也做真正的流式：子智能体的 token 通过事件透传到主智能体的 EventStream，让用户能看到子智能体实时生成答案（当前是缓冲后一次性发送）
- [ ] (可选) 在前端显示是哪个子智能体响应了（如 `🤖 基层调解助手回答` 而非 `🤖 回答`）
