# Knowledge Core (KB-Core)

## 简介

基于 Agent 的智能知识库系统。支持文件入库 → 智能切分 → 向量化 → 混合检索 → LLM 问答，全链路自动化。

## 目标

让非技术用户也能把任意格式的文档（PDF/Markdown/代码等）变成可查询的知识库，并通过自然语言问答获取信息。

## 技术栈

| 层面 | 技术 | 选型理由 |
|------|------|---------|
| 运行时 | **Bun** | 原生 TS、内置测试/打包、启动快 4-5x |
| 语言 | **TypeScript (strict)** | Drizzle 强类型、IDE 提示、重构安全 |
| Web 框架 | **Hono** | 轻量、原生 WS、Cloudflare 兼容 |
| 数据库 | **PostgreSQL 16 + pgvector** | pgvector 原生向量检索、全文检索一体化 |
| ORM | **Drizzle** | 强类型推断、SQL 式 DSL、迁移工具 |
| 向量检索 | **pgvector + HNSW** | 复用 PG 连接、无需额外服务 |
| 全文检索 | **PG tsvector** | 复用 PG、无需额外服务 |
| 嵌入模型 | **OpenAI text-embedding-3-small** | 1024 维、性价比高 |
| LLM | **OpenAI GPT-4o** | 工具调用稳定、上下文窗口够用 |
| 任务队列 | **BullMQ + Redis** | 成熟的 Node 队列、支持优先级和延迟 |

## 架构分层

```
Agent（LLM 自主编排）
  └── Skill（SKILL.md 驱动，固化最佳实践）
        └── Tool（原子操作，可独立测试）
              └── Data（Schema + Client）
```

## 模块概览

| 模块 | 路径 | 职责 |
|------|------|------|
| 配置 | `src/config/` | zod 校验，env 加载 |
| 缓存 | `src/cache/` | TTL + LRU，避免重复计算 |
| 数据库 | `src/db/` | Drizzle Schema + Client |
| 解析 | `src/parser/` | PDF / Markdown / 纯文本解析 |
| 切分 | `src/splitter/` | Recursive + ParentChild 策略 |
| 嵌入 | `src/embedding/` | 文本向量化（OpenAI） |
| LLM | `src/llm/` | LLM 调用封装 |
| 检索 | `src/retrieve/` | Dense + Sparse + Rerank + RRF 融合 |
| Tools | `src/tools/` | 5 个原子操作（search/add_doc/delete_doc/list_docs/get_chunk） |
| Skills | `src/skills/` | SKILL.md 驱动的任务编排（query/ingest/manage_docs 等） |
| Agent | `src/agent/` | QueryAgent 智能 Loop（Tool/Skill/Direct 三种终止） |
| Hooks | `src/hooks/` | 横切拦截（日志、指标、过滤） |
| Pipeline | `src/pipeline/` | BullMQ 入库流水线 |
| 路由 | `src/routes/` | HTTP 路由（/ingest, /query, /documents） |

## 入口文件

| 文件 | 用途 |
|------|------|
| `src/index.ts` | HTTP 主服务（Hono + WS） |
| `src/pipeline/worker.ts` | BullMQ Worker（入库任务） |

## 对外 API

| API | 用途 |
|-----|------|
| `POST /ingest` | 文件入库（文件上传 → 异步处理） |
| `WS /ws/query` | 实时检索问答（流式输出） |
| `GET /documents` | 查询文档列表 |
| `GET /documents/:id` | 查询单个文档 |
| `DELETE /documents/:id` | 删除文档（软删） |

## 开发进度

**Phase 1 全部完成** ✅ —— 40 Steps（1A~1H）全过
- 1A: 骨架（config/缓存/HTTP）
- 1B: Schema + Drizzle
- 1C: 数据处理（Parser/Splitter/Embedding/LLM/检索）
- 1D: Tool 层
- 1E: Skill 层
- 1F: Hooks 层
- 1G: Agent 层
- 1H: Pipeline + 路由 + 集成测试

**Review 问题**：18/20 已修复（#17 #20 待修）

## 关键文档

| 文档 | 路径 | 用途 |
|------|------|------|
| 项目入口 | `PROJECT.md` | 本文件 |
| Agent 规则 | `AGENTS.md` | AI Agent 工作指南 |
| 开发文档 | `docs/开发文档.md` | 开发唯一入口（Step 追踪 + 详细代码） |
| 知识库设计 | `docs/知识库设计.md` | 架构设计（V6） |
| 选型说明 | `docs/选型说明.md` | 技术选型理由 |
| 变更日志 | `openspec/changelog/` | 代码变更记录 |
| 设计文档 | `openspec/add/` | 新功能设计 |
| 架构改动 | `openspec/change/` | 架构级改动 |
