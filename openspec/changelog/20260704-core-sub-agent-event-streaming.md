# 变更日志：子智能体事件流可视化

**日期**：2026-07-04
**项目缩写**：core
**类型**：功能新增

## 变更摘要

当主智能体调用子智能体（`call_agent`）时，子智能体的内部过程（思考 + 工具调用）不再被"吞掉"，而是实时流式显示给用户，让用户看到完整的决策路径。子智能体的最终答案作为主答案的流式输入透传给前端。

## 变更详情

### 事件流协议设计

子智能体的事件分为两类，显示策略不同：

| 事件类型 | 显示策略 | 说明 |
|---------|---------|------|
| `thinking_*` | dim + `[智能体名]` 徽章 | 子 agent 的 LLM 思考内容 |
| `tool_call_*` | dim + 缩进 `→ 🔧 tool` | 子 agent 调用的工具 |
| `answer_*` | **无徽章**（透传） | 子 agent 的最终答案 = 主答案 |

### 协议实现

**`AgentEvent` 类型扩展**（`src/agent/types.ts`）：
- 新增 `SubAgentRef` 接口：`{ name: string; displayName: string }`
- `thinking_*` 和 `tool_call_*` 加可选字段 `subAgent?: SubAgentRef`
- `answer_*` 事件**不带** `subAgent`（作为最终答案，前端按主答案处理）

**`call-agent.ts`**：
- 工具签名改为 `execute(params, ctx)`，从 `ctx.events` 拿主 agent 的 EventStream
- 构造 wrapper EventStream 转发子 agent 的事件：
  - `answer_*` 事件 → 直接 emit（不带 subAgent）
  - 其他事件 → emit 时注入 `subAgent: { name, displayName }`

**`query-agent.ts`**：
- `executeCallable()` 把 `events` 加入 `toolCtx`，让工具能拿到

**`tools/types.ts` ToolContext**：
- 加可选 `events?: EventStream`

**`ws/query.ts`**：
- `wsEvents.emit()` 转发时保留 `subAgent` 字段

**前端 `chat.ts`**：
- 收到带 `subAgent` 的事件时：
  1. 立即 `stopSpinner()` 避免主 spinner 与子事件行重叠
  2. 用 `C.dim` + `💭 [displayName]` 或 `→ 🔧 action` 样式渲染
  3. 直接 `return`，**不触碰主状态机**（避免 phase/lastStep 被污染）

### 用户体验

修复前：
```
❯ 我试用期被辞退了，我怎么办？
💭 您的问题属于...

🔧 call_agent (tool)                 ← 这里卡住 60 秒，黑盒
✅ call_agent

🤖 回答
...
```

修复后：
```
❯ 我试用期被辞退了，我怎么办？
💭 根据您的情况，这属于劳动争议领域，我帮您转接给基层调解助手详细分析。

  💭 [基层调解助手] 根据《劳动法》第25条...    ← 子 agent 思考可见
  
    → 🔧 qa                                   ← 子 agent 的工具调用，缩进
    → 🔧 search_knowledge
    → ✅ search_knowledge ×3
    
  ✅ call_agent                              ← 主 agent 完成

🤖 回答                                       ← 子 agent 最终答案作为主答案
## 试用期被辞退：法律全面解析
...
```

## 影响的文件/模块

| 文件 | 变更 |
|------|------|
| `src/agent/types.ts` | 新增 SubAgentRef；AgentEvent 加 subAgent 字段 |
| `src/tools/call-agent.ts` | 接入 ctx.events；wrapper 转发事件 |
| `src/tools/types.ts` | ToolContext 加 events 字段 |
| `src/agent/query-agent.ts` | executeCallable 传 events 到 toolCtx |
| `src/ws/query.ts` | wsEvents 转发时保留 subAgent |
| `tests/chat.ts` | 处理 subAgent 事件（dim + 徽章 + 缩进） |

## 验证方式

- [x] `bun run typecheck` 0 errors
- [x] 实测问答：主 agent 思考 → `call_agent` → 子 agent 思考（💭 [基层调解助手]...）→ 子 agent 工具调用（缩进 `→ 🔧 search_knowledge`）→ 子 agent 最终答案作为主 answer 流式输出
- [x] 显示名正确（中文 `基层调解助手` 而非代码标识 `mediation`）
- [x] 子 agent 工具调用缩进 4 空格 + dim
- [x] 主 agent 的 spinner 在子事件到来时自动停止，避免行重叠
- [x] 答案区（🤖 回答）无 subAgent 徽章，作为纯粹的主答案流式显示

## 后续工作

- [ ] (可选) 子 agent 嵌套（sub-sub-agent）显示支持（缩进多层）
- [ ] (可选) 前端 Web UI 处理 subAgent 事件（status/js/pages/chat.js）
- [ ] (可选) 显示子 agent 的耗时占比（如"基层调解助手耗时 52s / 总 68s"）
