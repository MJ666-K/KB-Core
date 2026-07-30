# 功能设计：会话内上传文档即时问答

**日期**：2026-07-30
**项目缩写**：core
**状态**：已完成

## 背景

用户在问答会话中常需要基于一份临时文档（合同、案例、Word/PDF 资料）提问。此前系统只能把文件走 `/ingest` 异步入库后再检索，无法做到「上传即问、即问即答」，更无法在多轮对话中持续携带该资料上下文。需要支持会话级、即时的文档上传问答。

## 需求

- [x] 支持在问答输入框上传 PDF / Word(.docx/.doc) / 文本(.txt/.md/.csv/.log)
- [x] 后端即时解析出文本，作为本轮问答的参考资料
- [x] 回答须充分参考该资料并结合多轮上下文，紧扣当前问题
- [x] 后续多轮对话持续携带该资料上下文
- [x] 文本过长自动截断，避免击穿上下文窗口

## 技术方案

### 架构影响

新增「会话附件解析器」独立于入库流水线的 ParserRegistry：前者基于内存 Buffer 即时解析返回文本，不入库、不切片、不向量化。这样会话问答与知识库入库职责分离。

### 数据模型

`chat_messages.meta`（jsonb）新增可选字段：

```ts
interface ChatMessageAttachment { filename: string; text: string }
interface ChatMessageMeta {
  // ... 原有字段
  attachments?: ChatMessageAttachment[]; // 用户消息携带的上传资料（持久化，供多轮重建上下文）
}
```

无需数据库迁移（jsonb 原有列即可承载新字段）。

### 接口设计

**新增** `POST /api/chat/attachments`（需 `chat:use` 权限）：
- multipart/form-data，字段 `file`
- 上限 20MB，扩展名白名单：pdf/docx/doc/txt/md/markdown/csv/log
- 响应：`{ filename, text, truncated, charCount }`

**扩展** WebSocket `/ws/query` 的 `options`：
- 新增 `attachments: Array<{filename, text}>`（≤5 条，每条 ≤50000 字符）
- 后端将附件文本注入本轮 user message 上下文，经 `QueryOptions.attachments` 流经 QueryAgent（直答/合成路径）与 SkillExecutor（Skill 路径）

### 多轮携带机制

- 当前轮：前端发 `question`（干净）+ `options.attachments`（本轮资料），后端拼接 `【用户上传的参考资料】` 块到 user message。
- 历史轮：前端从 DB `meta.attachments` 重建历史时，对带附件的 user 消息把附件块拼进 `history.content`，使过去资料在后续每一轮都进入 LLM 上下文。

### 关键依赖与坑

| 决策 | 选择 | 理由 |
|------|------|------|
| PDF 解析 | `pdf-parse@2` | 纯 JS、Bun 兼容 |
| Word 解析 | `mammoth@1` | 纯 JS、`extractRawText` 稳定 |
| pdfjs DOM 全局缺失 | 最小 DOM 桩（DOMMatrix/DOMRect/ImageData/Path2D） | pdf-parse v2 依赖 pdfjs-dist，其在模块加载即 `new DOMMatrix()`；文本提取路径不依赖真实渲染，提供桩即可避免 Bun 崩溃 |
| 文本截断阈值 | 24000 字符/文件 | 兼顾大文档与上下文预算 |
| 存储方式 | 不入 Redis，直接返回文本由前端持有 + 持久化到消息 meta | 避免引入 TTL 复杂度，多轮依赖 DB meta 重建 |

## 影响范围

| 文件/模块 | 变更类型 | 说明 |
|----------|---------|------|
| `app/src/parser/chat-attachment-parser.ts` | 新增 | Buffer 即时解析（pdf/docx/doc/txt），含 pdfjs DOM 桩 |
| `app/src/routes/chat.ts` | 修改 | 新增 `POST /attachments` |
| `app/src/ws/query.ts` | 修改 | query schema 接收 `attachments` 并传入 agent |
| `app/src/db/schema/chat-session.ts` | 修改 | `ChatMessageMeta.attachments` |
| `app/src/agent/types.ts` | 修改 | `QueryOptions.attachments` |
| `app/src/agent/query-agent.ts` | 修改 | 直答/合成路径拼接附件上下文；Skill 上下文透传附件 |
| `status/src/api.ts` | 修改 | `uploadChatAttachment` + meta 类型扩展 attachments |
| `status/src/pages/Chat.tsx` | 修改 | 回形针上传、附件 chip、历史携带附件上下文、消息持久化 |

## 测试计划

- [x] 解析器 txt/docx/pdf 分支 API 冒烟通过（pdf 在坏文件上正确抛 InvalidPDFException）
- [x] 后端 typecheck 通过
- [x] 前端 typecheck + vite build 通过

## 时间估算

实际已完成。
