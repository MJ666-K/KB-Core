# Changelog - 增强后台日志详细信息

**日期**：2026-07-04
**项目缩写**：backend
**类型**：功能增强

## 变更摘要

系统性增强了后台日志的详细程度，覆盖 WebSocket 处理、Agent 决策、LLM 调用、工具执行、检索等关键路径。所有日志使用统一前缀和结构化 JSON 数据，便于排查问题和追踪性能瓶颈。

## 变更详情

### 1. WebSocket 处理 (`src/ws/query.ts`)

**新增日志**：
- `[WS:<queryId>] 收到查询请求` — 每次 WebSocket 消息到达
- `[WS:<queryId>] 开始处理查询` — 包含: question (截取前 100 字), datasetId, historyLen, topK, maxIterations
- `[WS:<queryId>] 查询完成` — 包含: elapsed, termination, citations, answerLen, toolCalls, iterations
- `[WS:<queryId>] 查询失败 (<elapsed>ms)` — 包含完整错误信息

**特点**：每个查询分配 8 位随机 ID（如 `ejza0x9b`），便于在并发场景下追踪。

### 2. Agent 决策 (`src/agent/query-agent.ts`)

**新增日志**：
- `[Agent] 开始执行` — 包含: query (截取前 100 字), model (显示 displayName + modelId), datasetId, historyLen, temperature, maxTokens
- `[Agent] 迭代 <N>` (DEBUG) — 包含: model, messagesCount, toolsCount
- `[Agent] 迭代 <N> → 直接回答 (<elapsed>ms)` — 包含: contentLen, content (截取前 200 字)
- `[Agent] 迭代 <N> → 请求工具调用 (<elapsed>ms)` — 包含: tools (逗号分隔), count
- `[Agent] <kind> <name> 返回结果 (<elapsed>ms)` — 包含: kind, answerLen/toolCalls/resultLen, citations/summary
- `[Agent] 终止路径: <skill|direct|synthesis>` — 包含完整终止信息
- `[Agent] 任务完成` — 包含: elapsed, termination, iterations, toolCalls, answerLen, citations
- `[Agent:LLM] stream 完成 (<elapsed>ms)` — 包含: model, tokens, decision (工具调用/直接回答)
- `[Agent:LLM] chat 完成 (<elapsed>ms)` (DEBUG) — 包含: model, contentLen, toolCalls

### 3. LLM 服务 (`src/llm/llm-service.ts`)

**新增日志**：
- `[LLM] chat 开始` — 包含: model, url, customApiKey, messagesCount, temperature, maxTokens, topK, topP, frequencyPenalty, presencePenalty, toolsCount, toolChoice
- `[LLM] chat 完成 (<elapsed>ms)` — 包含: model, contentLen, toolCallsCount, toolCalls (逗号分隔)
- `[LLM] stream 开始` — 包含: model, url, customApiKey, messagesCount, temperature, maxTokens, topK, topP, frequencyPenalty, presencePenalty, toolsCount, toolChoice
- `[LLM] stream 完成 (<elapsed>ms)` — 包含: model, tokens (SSE chunk 数量), decision (工具/<工具名>/直接回答)

### 4. 工具调用 (`src/tools/`)

**call-agent (`src/tools/call-agent.ts`)**：
- `[call_agent] 路由到子智能体` — 包含: target, displayName, model (模型显示名), modelId (实际模型 ID), question, datasetIds, topK, maxIterations
- `[call_agent] 子智能体返回` — 包含: target, elapsed, answerLen, citations, toolCalls
- `[call_agent] 子智能体失败 (<elapsed>ms)` — 包含: target, error (完整错误对象)

**search-knowledge (`src/tools/search-knowledge.ts`)**：
- `[检索] 开始 search_knowledge` — 包含: query (截取前 100 字), topK, datasetId, datasetIds
- `[检索] search_knowledge 完成 (<elapsed>ms)` — 包含: query, topK, denseCount, sparseCount, rrfCount, rerankCount, rerankFallback, finalResults, topScores (前 3 个结果 ID=score)

## 日志样例

完整查询流程（`"试用期被辞退怎么办"`）的日志输出：

```
[08:05:53.805] [INFO] [WS:ly6fm0ux] 收到查询请求
[08:05:53.807] [INFO] [WS:ly6fm0ux] 开始处理查询 {
  question: "试用期被辞退怎么办",
  datasetId: "c4b9520f",
  historyLen: 1,
  topK: undefined,
  maxIterations: undefined,
}
[08:05:53.808] [INFO] [Agent] 开始执行 {
  query: "试用期被辞退怎么办",
  model: "default",
  datasetId: "c4b9520f",
  historyLen: 1,
  temperature: undefined,
  maxTokens: undefined,
}
[08:05:53.810] [INFO] [LLM] stream 开始 {
  model: "deepseek-v4-pro",
  url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  customApiKey: false,
  messagesCount: 3,
  temperature: 0.2,
  maxTokens: undefined,
  toolsCount: 12,
  toolChoice: "auto",
}
[08:05:57.954] [INFO] [LLM] stream 完成 (4144ms) {
  model: "deepseek-v4-pro",
  tokens: 0,
  decision: "工具: call_agent",
}
[08:05:57.954] [INFO] [Agent:LLM] stream 完成 (4145ms) {
  model: "default",
  tokens: 0,
  decision: "工具调用: call_agent",
}
[08:05:57.954] [INFO] [Agent] 迭代 1 → 请求工具调用 (4145ms) {
  tools: "call_agent",
  count: 1,
}
[08:05:57.955] [INFO] [call_agent] 路由到子智能体 {
  target: "mediation",
  displayName: "基层调解助手",
  model: "DeepSeek V4 Pro",
  modelId: "deepseek-reasoner",  ← ⚠️ 这个 modelId 在 dashscope 上不存在
  question: "试用期被辞退怎么办？...",
  datasetIds: [ "c4b9520f" ],
}
[08:05:57.996] [ERROR] LLM Stream error {
  status: 404,
  body: "model_not_found: deepseek-reasoner",
}
[08:05:57.996] [ERROR] [call_agent] 子智能体失败 (40ms) {
  target: "mediation",
  error: "...",
}
[08:06:02.200] [INFO] [Agent] 迭代 2 → 请求工具调用 (4204ms) {
  tools: "qa",
  count: 1,
}
[检索] 开始 search_knowledge {
  query: "劳动合同法 第八十七条 赔偿金 违法解除",
  topK: 10,
  datasetId: "c4b9520f",
}
[检索] search_knowledge 完成 (414ms) {
  denseCount: 30,
  sparseCount: 0,
  rrfCount: 30,
  rerankCount: 10,
  rerankFallback: false,
  finalResults: 4,
  topScores: "dc9c2049=0.636, 99d965ce=0.636, 0be3a605=0.635",
}
[08:06:47.597] [INFO] [Agent] 任务完成 {
  elapsed: "53789ms",
  termination: "skill",
  iterations: 2,
  toolCalls: "call_agent,qa",
  answerLen: 1880,
  citations: 8,
}
[08:06:47.607] [INFO] [WS:ly6fm0ux] 查询完成 {
  elapsed: "53802ms",
  termination: "skill",
  citations: 8,
  answerLen: 1880,
  toolCalls: "call_agent,qa",
  iterations: 2,
}
```

## 性能分析

从日志可以清晰看到：
- **主 Agent 决策耗时**：~4s（选择调用 `mediation` 子智能体）
- **检索耗时**：~400ms（单次 search_knowledge）
- **子 Agent 失败恢复**：40ms 后快速重试 `qa` skill
- **总查询耗时**：53.8s（主要花在 deepseek-v4-pro 推理上）

## ⚠️ 发现的配置问题

日志揭示了一个配置错误：

```
[call_agent] 路由到子智能体 {
  target: "mediation",
  model: "DeepSeek V4 Pro",
  modelId: "deepseek-reasoner",  ← ❌ 这个 modelId 在 dashscope 上不存在!
}
```

dashscope API 返回 404：`The model 'deepseek-reasoner' does not exist or you do not have access to it.`

**修复建议**：检查 `src/db/migrations/manual_add_agents_and_skills.sql` 中 `deepseek-v4-pro` 模型的 `model_id` 字段，应该改为实际可用的模型 ID（如 `deepseek-chat` 或阿里云上的正确名称）。

## 验证

✅ Typecheck 通过
✅ 现有测试通过
✅ 查询流程能正确输出结构化日志
✅ 错误场景也能清晰记录错误堆栈

## 下一步

1. 修复 `deepseek-v4-pro` 的 `model_id` 配置
2. 考虑将 `subAgentEvents` 中的 DEBUG 级别 `forwarding ${event.type}` 改为只在关键事件时输出
