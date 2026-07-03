# 变更日志：LLM 流式输出 + Agent 事件流 + CLI 流式交互

**日期**：2026-07-03
**项目缩写**：core
**类型**：功能新增

## 变更摘要

实现 LLM 流式输出 + Agent 执行过程实时推送 + CLI 流式交互。用户体验从「等 10-30s spinner → 一次性出答案」变为「12ms 开始出字 → 实时看到 Agent 每一步在做什么」。

## 变更详情

### 后端

1. **LLMService.chatStream()** — 新增 OpenAI SSE streaming 支持
   - 返回 `AsyncIterable<StreamChunk>`，支持 token 流 + tool_calls 增量解析
   - 完整处理 SSE 协议：`data:` 行、`[DONE]` 终止、delta 累积 tool_calls

2. **EventStream 事件系统** (`src/agent/types.ts`)
   - `thinking_start/token/end` — Agent 思考过程
   - `tool_call_start/end` — 工具执行进度
   - `answer_start/token/end` — 答案 token 流
   - `result_end` — 最终结果（citations + 统计）

3. **QueryAgent.execute()** — 接受 `events?: EventStream`
   - 有 events 时走 chatStream，否则走原 chat()
   - Skill 返回后立即 break（不再二次 LLM 调用）
   - `streamOrChat()` 辅助方法统一两种调用模式

4. **SkillExecutor** — 最终答案用 chatStream 流式输出
   - 中间迭代（调用工具）用非流式
   - 工具执行前后发 `tool_call_start/end` 事件

5. **WebSocket 协议扩展** (`src/ws/query.ts`)
   - 新增消息类型：`thinking`, `thinking_end`, `step`, `step_end`, `answer_start`, `token`, `answer_end`
   - 原 `result` 消息保留（最终结果 + citations + stats）

### 前端 CLI

6. **tests/chat.ts** — 全新流式 CLI 客户端
   - thinking tokens 灰色实时显示 `💭`
   - 工具调用显示 `🔧 调用 xxx...` → `✅ xxx 完成`
   - 答案 tokens 实时流式输出 `🤖`
   - spinner 仅在纯等待时显示
   - 多轮历史（10 轮）自动累积

## 影响的文件/模块

| 文件/模块 | 变更类型 | 说明 |
|----------|---------|------|
| `src/llm/llm-service.ts` | 修改 | 新增 chatStream() SSE 解析 |
| `src/agent/types.ts` | 修改 | 新增 EventStream + AgentEvent 类型 |
| `src/agent/query-agent.ts` | 修改 | 流式执行 + skillDone break |
| `src/skills/executor.ts` | 修改 | 流式答案 + 工具事件 |
| `src/skills/types.ts` | 修改 | SkillContext 加 events |
| `src/ws/query.ts` | 修改 | 多消息类型 EventStream |
| `tests/chat.ts` | 重写 | 流式 CLI 客户端 |
| `tests/ingest-data.ts` | 新增 | 批量入库脚本 |

## 验证方式

- [x] `bun run typecheck` — 0 errors
- [x] 单元测试 26/26 pass
- [x] "你好" → 💭 16ms 开始流式输出
- [x] "劳动合同法第39条" → 12ms 开始 → 工具调用实时显示 → 答案流式
- [x] Citations: 6 ✅（修复有效）
- [x] 无重复答案（skillDone break 有效）

## 后续工作

- [ ] 直接回答(direct)路径的 thinking → answer 去重优化
- [ ] 添加 `stream` 选项到 WebSocket 请求 schema（可选关闭）
