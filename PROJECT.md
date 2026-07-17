# Knowledge Core (KB-Core)

## 简介

基于 Agent 的智能知识库系统。支持文件入库 → 智能切分 → 向量化 → 混合检索 → LLM 问答，全链路自动化。

## 目标

让非技术用户也能把任意格式的文档（PDF/Markdown/代码等）变成可查询的知识库，并通过自然语言问答获取信息。

## 仓库结构

KB-Core 是一个 monorepo：

```
KB-Core/
├── app/        # 后端服务（Bun + Hono + Drizzle + BullMQ）
├── status/     # 前端控制台（React 18 + Ant Design + Vite）
├── deploy/     # 生产部署（多阶段 Dockerfile + docker-compose）
├── data/       # 示例数据（中国法律法规文本）
├── docs/       # 设计文档
└── openspec/   # 变更管理（add / change / changelog）
```

## 技术栈

| 层面 | 技术 | 选型理由 |
|------|------|---------|
| 运行时 | **Bun** | 原生 TS、内置测试/打包、启动快 |
| 语言 | **TypeScript (strict)** | Drizzle 强类型、IDE 提示、重构安全 |
| Web 框架 | **Hono** | 轻量、原生 WS、Cloudflare 兼容 |
| 数据库 | **PostgreSQL 16 + pgvector** | pgvector 向量检索、tsvector 全文检索一体化 |
| ORM | **Drizzle** | 强类型推断、SQL 式 DSL、迁移工具 |
| 任务队列 | **BullMQ + Redis** | 成熟的 Node 队列、支持优先级和延迟 |
| 前端 | **React 18 + Ant Design + Vite** | 组件完备、类型友好、构建快 |
| LLM | **OpenAI 兼容接口**（默认阿里通义千问 qwen-plus） | 走兼容协议，可替换任意兼容服务 |
| 嵌入模型 | **OpenAI 兼容接口**（默认 text-embedding-v3，1024 维） | 性价比高，可替换 |
| 重排序 | **qwen3-rerank** | 提升 Top-K 精度 |
| 对象存储 | **阿里云 OSS**（可选） | 不配置则文档存本地 `./documents` |

> LLM / Embedding / Reranker 均走 OpenAI 兼容接口，可替换为任何兼容服务。

## 架构分层

```
Agent（LLM 自主编排，主 Agent 可调度多个子 Agent）
  └── Skill（SKILL.md 驱动，固化最佳实践，自带 JSON Schema）
        └── Tool（原子操作，可独立测试）
              └── Data（Drizzle Schema + Client）
```

Agent Loop 支持三种终止路径：命中 Skill、综合合成、直接回答。

## 后端模块（`app/src/`，三层分组 + 垂直特性切片）

依赖方向单向：`entry → features → infra → core`。跨模块 import 使用路径别名 `@core/* / @infra/* / @features/* / @entry/*`。

### ① core/（内核：跨业务共用，零业务依赖）

| 模块 | 路径 | 职责 |
|------|------|------|
| 配置 | `core/config/` | zod 校验，env 加载 |
| 数据库 | `core/db/` | Drizzle Schema + Client + 迁移/种子 |
| 缓存 | `core/cache/` | TTL + LRU |
| Redis | `core/redis/` | Redis 客户端 |
| 共享类型 | `core/shared/` | 跨 feature 的领域模型与类型（Citation / AgentStep 等）|
| 工具函数 | `core/utils/` | hash / logger / text-normalize |

### ② infra/（平台基础设施：外部适配器）

| 模块 | 路径 | 职责 |
|------|------|------|
| LLM | `infra/llm/` | LLM 调用封装（chat / stream / generate）|
| 嵌入 | `infra/embedding/` | 文本向量化（OpenAI 兼容）|
| 存储 | `infra/storage/` | 文档存储（本地 / OSS 抽象）|
| Hooks | `infra/hooks/` | 横切拦截（audit / rate-limit，异常隔离）|
| 运行时配置 | `infra/settings/` | 热更新设置 |
| 认证 | `infra/auth/` | JWT + RBAC + query-job-store |

### ③ features/（业务能力：垂直切片，一等公民）

| Feature | 路径 | 内含 |
|---------|------|------|
| 知识库核心 | `features/kb/` | parser / splitter / retrieve / pipeline / tools（search·get·list·summarize）/ routes（ingest·documents·datasets）|
| 查询链路 | `features/chat/` | agent（Main + Query + SubAgentRegistry）/ ws / skills（基础设施 + builtin: qa·search·compare·summary·multihop·chat·followups·mediation）/ tools（call-agent）/ routes（chat·sessions·query-jobs）|
| Excel 分析 | `features/excel/` | parser / tools（4 个）/ skills（excel-analysis·excel-profiling）/ analyze（DuckDB）/ routes |
| 知识图谱 | `features/kg/` | client / ingest / seed / tools / routes |
| 管理后台 | `features/admin/` | routes（agents·models·skills·skill-meta·settings·users·roles·stats）|

### ④ entry/（组装根）

| 文件 | 职责 |
|------|------|
| `entry/index.ts` | HTTP 主入口（Hono + WS + 静态前端 + DI 组装）|
| `entry/worker.ts` | BullMQ Worker 入口（入库任务）|
| `entry/routes.ts` | 集中路由挂载（按 feature 注册）|

## 前端模块（`status/src/`）

| 模块 | 路径 | 职责 |
|------|------|------|
| 页面 | `pages/` | Dashboard / Chat / Agents / DocDetail |
| 认证 | `auth/` | 认证上下文 / 路由守卫 / 权限判断 |
| 访问控制 | `components/access/` | 角色管理 / 用户管理 / 权限组 |

## 入口文件

| 文件 | 用途 |
|------|------|
| `app/src/entry/index.ts` | HTTP 主服务（Hono + WS + 静态前端 + DI 组装） |
| `app/src/entry/worker.ts` | BullMQ Worker（入库任务） |
| `app/src/entry/routes.ts` | 集中按 feature 挂载路由 |
| `status/src/main.tsx` | 前端入口 |

## 对外 API

后端 HTTP + WebSocket 路由（除 `/health` 与 `/auth/*` 均需认证）：

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/auth/...` | 登录 / 刷新 Token / 登出 |
| POST | `/ingest` | 文件入库（异步处理） |
| WS | `/ws/query` | 实时检索问答（流式输出） |
| GET / DELETE | `/documents`、`/documents/:id` | 文档列表 / 详情 / 删除（软删） |
| GET / POST / PATCH | `/datasets` | 数据集管理 |
| POST | `/query-jobs` | 长查询异步任务 |
| GET / PATCH | `/agents`、`/skills` | Agent / Skill 元数据管理 |
| GET / PATCH | `/settings` | 运行时配置（热更新） |
| GET / POST / PATCH | `/users`、`/roles` | 用户 / 角色管理（RBAC） |
| GET | `/stats` | 统计指标 |
| GET | `/sessions`、`/chat`、`/models`、`/skill-meta` | 会话 / 对话 / 模型 / Skill 元信息 |

## 开发进度

**Phase 1 全部完成** —— 40 Steps（1A~1H）全过

- 1A: 骨架（config / 缓存 / HTTP）
- 1B: Schema + Drizzle
- 1C: 数据处理（Parser / Splitter / Embedding / LLM / 检索）
- 1D: Tool 层
- 1E: Skill 层
- 1F: Hooks 层
- 1G: Agent 层
- 1H: Pipeline + 路由 + 集成测试

后续迭代（认证 / RBAC / 前端控制台 / Agent 子代理调度 / OSS 存储 / 运行时设置）在 Phase 1 之后按 OpenSpec 流程推进，变更见 `openspec/changelog/`。

## 关键文档

| 文档 | 路径 | 用途 |
|------|------|------|
| 项目 README | `README.md` | 项目介绍 + 快速开始 + 部署 |
| 项目入口 | `PROJECT.md` | 本文件（模块概览 + 技术栈 + API） |
| Agent 规则 | `AGENTS.md` | AI Agent 工作指南 |
| 开发文档 | `docs/开发文档.md` | 开发唯一入口（Step 追踪 + 详细代码） |
| 知识库设计 | `docs/知识库设计.md` | 架构设计 |
| 选型说明 | `docs/选型说明.md` | 技术选型理由 |
| 变更日志 | `openspec/changelog/` | 代码变更记录 |
| 设计文档 | `openspec/add/` | 新功能设计 |
| 架构改动 | `openspec/change/` | 架构级改动 |
| 部署细节 | `deploy/README.md` | Docker 构建与部署 |
