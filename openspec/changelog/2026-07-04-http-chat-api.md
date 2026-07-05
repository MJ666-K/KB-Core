# Changelog: HTTP API Endpoints for Chat

**日期**: 2026-07-04  
**作者**: Sisyphus  
**类型**: Feature Enhancement  
**状态**: 已完成

## 概述

实现了两个 HTTP API 端点用于聊天功能，方便测试和第三方集成：
- `POST /api/chat` - 非流式聊天（简单请求）
- `POST /api/chat/stream` - 流式聊天（Server-Sent Events）

## 变更内容

### 1. 新增 `/api/chat` HTTP 端点
**文件**: `src/routes/chat.ts` (新建)

- 使用 HTTP POST 请求发送问题
- 返回完整 JSON 响应（非流式）
- 适合简单测试和第三方集成

**请求格式**:
```json
{
  "question": "劳动法第39条是什么内容",
  "datasetId": "c4b9520f-41e5-4c21-bc7d-97b8d68e33a3",
  "topK": 5,
  "maxIterations": 5,
  "history": [
    {"role": "user", "content": "之前的问题"},
    {"role": "assistant", "content": "之前的回答"}
  ]
}
```

**响应格式**:
```json
{
  "success": true,
  "answer": "回答内容...",
  "citations": [...],
  "duration": 20157,
  "termination": "skill",
  "modelUsed": "qwen-max",
  "searchCount": 4
}
```

### 2. 新增 `/api/chat/stream` 流式端点
**文件**: `src/routes/chat.ts`

- 使用 Server-Sent Events (SSE) 实现流式输出
- 实时显示 Agent 的思考过程、工具调用和回答
- 适合需要实时反馈的交互式应用

**流式事件类型**:
- `thinking_start` - Agent 开始思考
- `thinking_end` - Agent 思考结束
- `tool_call_start` - 开始调用工具（包含工具名称和类型）
- `tool_call_end` - 工具调用结束（包含摘要信息）
- `chunk` - 回答内容的 token（流式输出）
- `complete` - 完整回答（包含最终答案、引用、持续时间等）
- `error` - 错误消息

**流式事件示例**:
```
event: thinking_start
data: {"type":"thinking_start"}

event: tool_call_start
data: {"type":"tool_call_start","name":"search_knowledge","kind":"tool"}

event: tool_call_end
data: {"type":"tool_call_end","name":"search_knowledge","summary":"找到 5 个相关片段..."}

event: chunk
data: {"type":"chunk","content":"根据"}

event: chunk
data: {"type":"chunk","content":"《中华人民共和国"}

event: complete
data: {"type":"complete","answer":"完整回答...","citations":[...]...}
```

### 3. 路由注册
**文件**: `src/routes/index.ts`

添加了 `chatRouter` 的注册：
```typescript
app.route('/api/chat', chatRouter);
```

## API 使用示例

### 1. 非流式聊天
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "question": "劳动法第39条是什么内容",
    "datasetId": "c4b9520f-41e5-4c21-bc7d-97b8d68e33a3"
  }'
```

### 2. 流式聊天
```bash
curl -N -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{
    "question": "劳动合同法中关于加班的规定",
    "datasetId": "c4b9520f-41e5-4c21-bc7d-97b8d68e33a3"
  }'
```

### 3. 测试脚本
```bash
bun run tests/test-chat-api.ts
```

## 技术细节

### 1. Agent Event Stream 传递
- Agent 的 `execute()` 方法接受 `EventStream` 参数
- 所有 Agent 的思考过程、工具调用、回答 token 都通过 EventStream 发送
- HTTP 路由将 EventStream 转换为 SSE 事件

### 2. 子 Agent 事件标记
- 子 Agent 的事件包含 `subAgent` 字段标识来源
- 例如：`{"type":"tool_call_start","name":"qa","subAgent":{"name":"mediation","displayName":"基层调解助手"}}`

### 3. 模型配置传递
- Agent 使用配置的模型（如 `deepseek-v4-pro`）发送请求
- 模型参数（temperature、maxTokens 等）从数据库配置读取

## 与前端页面的关系

当前前端 `pages/chat.js` 使用 WebSocket (`/ws/query`)：
- WebSocket 更适合长连接、双向通信
- 前端可以实时接收 Agent 的思考过程

新增的 HTTP API 适合：
- 简单的测试和调试
- 第三方系统集成
- 命令行测试（curl）
- 不需要 WebSocket 的场景

## 测试状态

✅ **已完成**:
- [x] `/api/chat` 非流式端点正常工作
- [x] `/api/chat/stream` 流式端点正常工作
- [x] 子 Agent 事件正确传递
- [x] 模型配置正确应用
- [x] 引用（citations）正确返回

✅ **测试命令**:
```bash
# 测试非流式 API
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "劳动法第39条", "datasetId": "c4b9520f-41e5-4c21-bc7d-97b8d68e33a3"}'

# 测试流式 API
curl -N -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"question": "劳动合同法中关于加班的规定", "datasetId": "c4b9520f-41e5-4c21-bc7d-97b8d68e33a3"}'

# 运行测试脚本
bun run tests/test-chat-api.ts
```

## 后续计划

1. **优化响应速度**（当前问题）:
   - 当前合成步骤耗时 ~51 秒（deepseek-v4-pro 太慢）
   - 建议：使用更快的模型（如 qwen-max）
   - 或者优化合成提示词，减少 token 数量

2. **前端集成**:
   - 可选：在前端 `pages/chat.js` 中添加 HTTP API 支持
   - 或者保持 WebSocket 为主，HTTP 仅用于测试

3. **API 文档**:
   - 可生成 OpenAPI/Swagger 文档
   - 提供在线 API 测试页面

## 验证命令

```bash
# 验证 API 可用
curl http://localhost:3000/api/chat/health

# 测试非流式
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "劳动法第39条"}'

# 测试流式
curl -N -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"question": "劳动法中关于加班的规定"}'
```

## 总结

成功实现了 HTTP API 端点，提供了灵活的测试方式。当前系统性能瓶颈在 LLM 合成步骤（~51秒），建议后续优化：
1. 使用更快的模型（qwen-max 代替 deepseek-v4-pro）
2. 优化提示词，减少合成步骤的 token 数量
3. 或者考虑使用流式合成（边生成边返回）
