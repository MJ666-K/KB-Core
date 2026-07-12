# Knowledge Core (KB-Core)

基于 Agent 的智能知识库系统。把任意格式的文档（PDF / Markdown / 纯文本 / 代码等）变成可查询的知识库，并通过自然语言问答获取信息——从文件入库、智能切分、向量化、混合检索到 LLM 问答，全链路自动化。

---

## 核心能力

- **多格式解析**：PDF、Markdown、纯文本自动解析与清洗
- **智能切分**：Recursive 与 Parent-Child 双策略，兼顾上下文完整与检索精度
- **混合检索**：Dense（向量）+ Sparse（全文）+ Rerank，RRF 融合排序
- **Agent 编排**：LLM 自主决策，Skill 固化最佳实践，Tool 原子可测；支持主 Agent 调度多个子 Agent
- **实时问答**：WebSocket 流式输出，长查询异步任务化
- **权限控制**：JWT 认证 + RBAC 角色权限（用户 / 角色 / 权限组）
- **可观测**：Hooks 横切日志、指标、过滤；运行时设置热更新
- **一键部署**：多阶段 Docker 镜像（前端构建 → Bun 运行）

## 架构分层

```
Agent（LLM 自主编排，主 Agent 可调度子 Agent）
  └── Skill（SKILL.md 驱动，固化最佳实践，自带 JSON Schema）
        └── Tool（原子操作，可独立测试）
              └── Data（Drizzle Schema + Client）
```

数据流：

```
上传文件 → Parser 解析 → Splitter 切分 → Embedding 向量化
        → PG + pgvector 入库

提问 → Hybrid Retriever（Dense + Sparse + Rerank + RRF）
     → Agent Loop（Tool / Skill / Direct 三种终止路径）
     → 流式输出答案
```

## 技术栈

| 层面 | 技术 |
|------|------|
| 运行时 | Bun |
| 语言 | TypeScript (strict) |
| Web 框架 | Hono |
| 数据库 | PostgreSQL 16 + pgvector（向量）+ tsvector（全文）|
| ORM | Drizzle |
| 任务队列 | BullMQ + Redis |
| 前端 | React 18 + Ant Design + Vite |
| LLM | OpenAI 兼容接口（默认阿里通义千问 qwen-plus）|
| Embedding | OpenAI 兼容接口（默认 text-embedding-v3，1024 维）|
| Reranker | qwen3-rerank |
| 对象存储 | 阿里云 OSS（可选，不配置则存本地）|
| 知识图谱 | Neo4j 5.20 Community（可选，`KG_ENABLED=true` 启用）|
| 前端可视化 | D3.js 7.x（`/kg` 页面力导向渲染）|

> LLM / Embedding / Reranker 均走 OpenAI 兼容接口，可替换为任何兼容服务。

## 项目结构

```
KB-Core/
├── app/                    # 后端服务（Bun + Hono + Drizzle）
│   ├── src/
│   │   ├── index.ts        # HTTP 主入口
│   │   ├── config/         # zod 校验的环境配置
│   │   ├── cache/          # TTL + LRU 缓存
│   │   ├── db/             # Drizzle Schema + 迁移
│   │   ├── parser/         # 文件解析
│   │   ├── splitter/       # 文本切分
│   │   ├── embedding/      # 向量化
│   │   ├── llm/            # LLM 调用封装
│   │   ├── retrieve/       # 混合检索 + RRF + Rerank
│   │   ├── tools/          # 原子操作（search / add_doc / delete_doc / list_docs / get_chunk …）
│   │   ├── skills/         # SKILL.md 驱动的任务编排
│   │   ├── agent/          # MainAgent + QueryAgent（自主编排 Loop）
│   │   ├── hooks/          # 横切拦截（日志 / 指标 / 过滤）
│   │   ├── pipeline/       # BullMQ 入库流水线
│   │   ├── routes/         # HTTP 路由
│   │   ├── ws/             # WebSocket 流式问答
│   │   ├── auth/           # JWT 认证中间件
│   │   ├── redis/          # Redis 客户端
│   │   ├── storage/        # 文档存储（本地 / OSS）
│   │   ├── settings/       # 运行时配置（热更新）
│   │   ├── models/         # 领域模型
│   │   └── utils/          # 工具函数
│   ├── tests/
│   ├── docker-compose.yml  # 本地开发用 PG + Redis
│   ├── drizzle.config.ts
│   └── .env.example
├── status/                 # 前端控制台（React + Antd + Vite）
│   └── src/
│       ├── pages/          # Dashboard / Chat / Agents / DocDetail
│       ├── auth/           # 认证上下文 / 路由守卫 / 权限
│       └── components/     # 角色管理 / 用户管理 / 权限组
├── deploy/                 # 生产部署
│   ├── Dockerfile          # 多阶段构建（前端 build → Bun 运行）
│   ├── docker-compose.yml  # postgres + redis + app
│   ├── build.sh            # 镜像构建
│   └── deploy.sh           # 部署脚本
├── data/                   # 示例数据（中国法律法规文本）
├── docs/                   # 设计文档
│   ├── 开发文档.md          # 开发唯一入口（Step 追踪 + 详细代码）
│   ├── 知识库设计.md        # 架构设计
│   └── 选型说明.md          # 技术选型理由
├── openspec/               # 变更管理（add / change / changelog）
├── PROJECT.md              # 项目入口
└── AGENTS.md               # AI Agent 工作指南
```

## 快速开始（本地开发）

### 前置依赖

- [Bun](https://bun.sh/) >= 1.2
- [Docker](https://www.docker.com/)（用于本地 PostgreSQL + Redis）
- Node.js >= 20（前端构建）

### 1. 启动基础设施

```bash
cd app
docker compose up -d        # 启动 PostgreSQL (pgvector) + Redis
```

### 2. 配置环境变量

```bash
cd app
cp .env.example .env
```

编辑 `.env`，至少填入：

- `LLM_API_KEY` / `LLM_API_URL` / `LLM_MODEL_ID` —— LLM 服务（OpenAI 兼容）
- `EMBEDDING_API_KEY` / `EMBEDDING_API_URL` / `EMBEDDING_MODEL_ID` —— 向量化服务
- `RERANK_API_KEY` / `RERANK_API_URL` / `RERANK_MODEL_ID` —— 重排序服务
- `JWT_SECRET` —— 改成一个足够长的随机串
- `AUTH_DEFAULT_PASSWORD` —— 超级管理员初始密码（首次启动时创建账号）

> 默认配置走阿里云百炼（dashscope）OpenAI 兼容接口。任何兼容 OpenAI 的服务都可替换。

### 3. 启动后端

```bash
cd app
bun run db:migrate          # 执行数据库迁移
bun run dev                 # 启动 HTTP 服务（watch，默认 :3000）
bun run worker              # 另开终端：启动入库 Worker
```

### 4. 启动前端

```bash
cd status
bun install
bun run dev                 # 默认 http://localhost:5173
```

前端开发模式下默认连接 `http://localhost:3000` 的后端。

### 5. 验证

```bash
curl http://localhost:3000/health
# {"status":"ok", ...}
```

浏览器打开 `http://localhost:5173`，用 `admin` + 你设置的密码登录。

### 6.（可选）启用知识图谱

知识图谱（Neo4j）默认关闭，按需启用：

```bash
# 1) 启动 Neo4j（与 Postgres + Redis 同命令）
cd app
docker compose up -d neo4j

# 2) 启用图谱（app/.env）
KG_ENABLED=true
NEO4J_URL=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=neo4j_dev_password   # 与 docker-compose.yml 里 NEO4J_AUTH 一致

# 3) 重启后端让 config 生效，然后入库默认图谱数据
bun run dev
curl -X POST http://localhost:3000/api/kg/ingest -H 'Content-Type: application/json' -d '{}'
```

图谱可视化：浏览器打开 `http://localhost:5173/kg`，左侧选根节点 / 搜索 / 调深度，中间 D3 力导向渲染，右侧节点详情。

## API 概览

后端 HTTP + WebSocket 路由（均需认证，除 `/health` 与 `/auth/*`）：

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/auth/...` | 登录 / 刷新 Token / 登出 |
| POST | `/ingest` | 文件入库（异步处理）|
| WS | `/ws/query` | 实时检索问答（流式）|
| GET / DELETE | `/documents` / `/documents/:id` | 文档列表 / 详情 / 删除 |
| GET / POST / PATCH | `/datasets` | 数据集管理 |
| POST | `/query-jobs` | 长查询异步任务 |
| GET / PATCH | `/agents`、`/skills` | Agent / Skill 元数据管理 |
| GET / PATCH | `/settings` | 运行时配置（热更新）|
| GET / POST / PATCH | `/users`、`/roles` | 用户 / 角色管理 |
| GET | `/stats` | 统计指标 |
| GET | `/sessions`、`/chat`、`/models`、`/skill-meta` | 会话 / 对话 / 模型 / Skill 元信息 |

> 入库 Worker 通过 BullMQ 异步处理解析 → 切分 → 向量化 → 入库流水线。

## Docker 部署（生产）

```bash
cd deploy
cp .env.example .env        # 首次，填入密钥与服务配置
./build.sh v1.0.0           # 构建镜像 kb-core:v1.0.0
./deploy.sh up              # 启动 postgres + redis + app
```

访问：http://localhost:3000 ｜ 健康检查：http://localhost:3000/health

数据持久化：

| 存储 | 方式 |
|------|------|
| PostgreSQL | Docker 命名卷 `kc_pgdata` |
| Redis | Docker 命名卷 `kc_redisdata` |
| 上传文档 | 宿主机 `./data`（或 OSS）|

备份数据库：

```bash
docker exec kc-postgres pg_dump -U postgres knowledge_core > backup.sql
```

> 部署细节见 `deploy/README.md`。

## 开发命令

后端（在 `app/`）：

```bash
bun run dev                 # 启动 HTTP 服务（watch）
bun run worker              # 启动入库 Worker
bun run db:generate         # 生成迁移 SQL
bun run db:migrate          # 执行迁移
bun run db:studio           # Drizzle Studio GUI
bun run typecheck           # tsc --noEmit
bun test                    # 所有单元测试
bun test tests/xxx.test.ts  # 指定文件
BUN_TEST_INTEGRATION=true bun test   # 集成测试（需要 DB）
bun run chat                # 终端对话（调试用）
```

前端（在 `status/`）：

```bash
bun run dev                 # 开发服务
bun run build               # 生产构建
bun run typecheck           # 类型检查
```

## 配置说明

完整配置见 `app/.env.example`，关键项：

| 配置 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串（pgvector）|
| `REDIS_URL` | Redis 连接串（BullMQ）|
| `LLM_*` / `EMBEDDING_*` / `RERANK_*` | 模型服务（OpenAI 兼容）|
| `CHUNK_PARENT_TOKENS` / `CHUNK_CHILD_TOKENS` | Parent-Child 切分参数 |
| `SEARCH_TOP_K` / `RRF_K` / `RERANK_TOP_K` | 检索融合参数 |
| `AGENT_MAX_ITERATIONS` / `AGENT_MAX_TOOL_CALLS` | Agent Loop 上限 |
| `JWT_SECRET` / `AUTH_DEFAULT_*` | 认证与初始管理员 |
| `OSS_*` | 可选，四项全填启用阿里云 OSS，否则文档存本地 |

## 文档导航

| 想了解 | 看哪里 |
|---|---|
| 项目全景 | `PROJECT.md` |
| AI Agent 工作规则 | `AGENTS.md` |
| 开发步骤与详细代码 | `docs/开发文档.md` |
| 架构设计 | `docs/知识库设计.md` |
| 技术选型理由 | `docs/选型说明.md` |
| 知识图谱设计（Neo4j + D3） | `docs/知识图谱设计.md` |
| 变更记录 | `openspec/changelog/` |
| 新功能设计 | `openspec/add/` |
| 架构改动 | `openspec/change/` |
| 部署细节 | `deploy/README.md` |

## 设计原则

1. **Agent 灵活，Skill 固化** —— Agent 层 LLM 自主决策，Skill 层固化最佳实践
2. **Skill 是一等公民** —— Skill 自己声明 JSON Schema（不只 query）
3. **Agent 不双重生成** —— Skill 返回的 answer 直接透传，不二次 LLM
4. **类型安全** —— strict 模式，禁止 `as any`
5. **批量优先** —— 数据库操作能用批量就不用循环
6. **安全边界** —— 所有 HTTP body 用 zod 校验，文件名 sanitize

## 作者

2212013739@qq.com

## License

未指定。如需使用请注明来源并联系作者（2212013739@qq.com）。
