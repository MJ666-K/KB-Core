# AGENTS.md

> **OpenCode 工作指南** —— 任何 AI Agent 在本项目工作前必须读完此文件。

---

## 项目概述

**Knowledge Core (KB-Core)** —— 基于 Agent 的知识库系统。

- Runtime: Bun + TypeScript (strict)
- Web: Hono
- DB: PostgreSQL 16 + pgvector + tsvector
- 架构: Agent → Skill → Tool → Data（分层，无硬编码路由）

---

## ⚠️ 强制工作流

**每次开始工作时，必须按以下步骤执行，不可跳过：**

### 1. 读文档

```
读 docs/开发文档.md → 找「开发步骤总览」→ 找第一个 - [ ] 未完成步骤
```

### 2. 实现一个步骤

- **只实现这一个步骤**，不要批量实现多个
- 跳转到该步骤对应的 Part 详细章节，**严格按照文档代码实现**
- 如果发现文档代码有错，**先修文档，再实现**

### 3. 测试

- 运行该步骤「测试」行指定的命令
- **测试必须全部通过**才能进入下一步
- 如果测试失败：修代码 → 重新测试（不要跳过测试）

### 4. 更新文档（两处）

#### 4a. 更新开发文档

在 `docs/开发文档.md` 的「开发步骤总览」中：

```
- [ ] **Step N**: ...      ← 改成
- [x] **Step N**: ...      ← 完成
```

#### 4b. 更新知识库设计（如有变化）

如果实现过程中**设计有变化**（新增字段、改了接口、调了流程），同步更新：
- `docs/知识库设计.md` —— 架构设计层面的变化
- `docs/开发文档.md` 对应 Step —— 代码示例的变化

### 5. 报告

报告内容：完成了哪个 Step、测试结果、是否有设计变更。

---

## 禁止事项

| 禁止 | 理由 |
|---|---|
| 一次实现多个 Step | 破坏渐进式验证，出错难定位 |
| 跳过测试 | 无法确认这步真的对了 |
| 跳过文档更新 | 下次开工找不到正确位置 |
| 修改不属于当前 Step 的代码 | 超出范围，引入风险 |
| 使用 `as any` / `@ts-ignore` | 项目 strict 模式，禁止类型逃逸 |
| 自己发明代码（不参考文档） | 文档是唯一真相，有分歧先修文档 |

---

## 文件结构

```
PROJECT.md               ← 项目入口（模块概览 + 技术栈 + API）
AGENTS.md                ← 本文件（Agent 工作规则）

openspec/                ← 设计文档 + 变更管理
├── README.md            ← OpenSpec 规范说明
├── add/                 ← 新功能设计文档（实现前必须写）
├── change/              ← 架构级改动文档
└── changelog/           ← 变更日志（与代码同批完成）

docs/
├── 开发文档.md          ← 开发唯一入口（步骤总览 + 详细代码）
├── 知识库设计.md        ← 架构设计（设计变更时更新）
├── 选型说明.md          ← 技术选型理由
└── 开发文档.legacy.md   ← 旧版备份（可删）

app/src/                       # 后端源码（三层分组 + 垂直特性切片）
├── core/                  # ① 内核：跨业务共用，零业务依赖
│   ├── config/            # 配置（zod 校验）
│   ├── db/                # 数据库（Drizzle）：client / schema / migrations / seed
│   ├── cache/             # TTL + LRU 缓存
│   ├── redis/             # Redis 客户端
│   ├── shared/            # 跨 feature 的领域模型与共享类型
│   └── utils/             # hash / logger / text-normalize
├── infra/                 # ② 平台基础设施：外部适配器
│   ├── llm/               # LLM 封装
│   ├── embedding/         # 向量化
│   ├── storage/           # 文档存储（本地 / OSS）
│   ├── hooks/             # 横切拦截（异常隔离）
│   ├── settings/          # 运行时热配置
│   └── auth/              # JWT + RBAC + query-job-store
├── features/              # ③ 业务能力（垂直切片，一等公民）
│   ├── kb/                #   知识库核心：parser / splitter / retrieve / pipeline / tools / routes
│   ├── chat/              #   查询链路：agent / ws / skills(+builtin) / tools / routes
│   ├── excel/             #   Excel：parser / tools / skills / analyze(DuckDB) / routes
│   ├── kg/                #   知识图谱：client / ingest / seed / tools / routes
│   └── admin/             #   管理后台：routes（agents / models / skills / users / roles ...）
└── entry/                 # ④ 组装根
    ├── index.ts           #   HTTP 主入口（Hono + WS + DI 组装）
    ├── worker.ts          #   BullMQ Worker 入口
    └── routes.ts          #   集中路由挂载

依赖方向单向：entry → features → infra → core
跨模块 import 用路径别名：@core/* @infra/* @features/* @entry/*

tests/                   # 测试（每个模块一个 .test.ts）
```

---

## 常用命令

```bash
# 开发
bun run dev                    # 启动开发服务（watch）
bun run worker                 # 启动入库 Worker

# 数据库
bun run db:generate            # 生成迁移 SQL
bun run db:migrate             # 执行迁移
bun run db:studio              # Drizzle Studio GUI

# 测试
bun test                       # 所有单元测试
bun test tests/xxx.test.ts     # 指定文件
BUN_TEST_INTEGRATION=true bun test  # 集成测试（需要 DB）

# 类型检查
bun run typecheck              # tsc --noEmit

# 基础设施
docker-compose up -d           # 启动 PostgreSQL + Redis
docker-compose ps              # 查看状态
```

---

## 设计原则（与开发文档 Part 0 一致）

1. **分层：Agent 灵活，Skill 固化** —— Agent 层 LLM 自主决策，Skill 层固化最佳实践
2. **Skill 是一等公民** —— Skill 自己声明 JSON Schema（不只 query）
3. **Agent 不双重生成** —— Skill 返回的 answer 直接透传，不二次 LLM
4. **类型安全** —— strict 模式，禁止 `as any`
5. **批量优先** —— 数据库操作能用批量就不用循环
6. **安全边界** —— 所有 HTTP body 用 zod 校验，文件名 sanitize

---

## 已修复的 Review 问题

开发文档已修复 18/20 个 review 问题。实现时注意：

| # | 修复要点 | 影响 Step |
|---|---|---|
| #1 | Agent 三种终止路径（skill/synthesis/direct） | Step 32 |
| #2 | Skill metadata 含 parameters JSON Schema | Step 24-28 |
| #3 | 用 `Bun.serve()` 不用 `export default` in function | Step 5, 38 |
| #4 | 批量 INSERT + UNNEST UPDATE | Step 34 |
| #5 | 文件名用 nanoid 重命名 | Step 35 |
| #11 | TTLCache 加 maxSize + LRU | Step 4 |
| #12 | chunkIndex → parentChunkIndex + childIndexWithinParent | Step 8, 15 |
| #18 | Hook 异常 try/catch 隔离 | Step 29 |
| #19 | 所有 API body zod 校验 | Step 35-37 |

---

## OpenSpec 变更工作流

Phase 1 完成后，项目进入自由迭代阶段。从此以后，所有变更遵循 OpenSpec 流程：

### 新功能 → `openspec/add/`

```
1. 写 openspec/add/{YYYYMMDD}-{缩写}-{描述}.md → 等用户确认
2. 实现代码 → 跑测试
3. openspec/changelog/ 记录变更（与代码同批）
```

### 架构改动 → `openspec/change/`

```
1. 写 openspec/change/{YYYYMMDD}-{缩写}-{描述}.md → 等用户确认
2. 回归测试 → openspec/changelog/ 记录
```

### Bug 修复 / 普通变更

```
改代码 → 跑测试 → openspec/changelog/ 记录（同批完成）
```

### 项目缩写表

| 缩写 | 范围 |
|------|------|
| `backend` | 后端 API、Worker、数据库 |
| `core` | 核心业务逻辑（Agent/Skill/Tool） |
| `pipeline` | 入库流水线、队列 |
| `deploy` | 部署、基础设施 |
| `global` | 全项目、跨模块、文档 |

> 详细命名规则、模板 → `openspec/README.md` + 各目录 `_template.md`

---

## 联系文档

| 想了解 | 看哪里 |
|---|---|
| 项目全景 | `PROJECT.md` |
| 下一步该做什么 | `docs/开发文档.md` → 开发步骤总览 |
| 这步怎么实现 | `docs/开发文档.md` → 对应 Part 详情 |
| 为什么这样设计 | `docs/知识库设计.md` |
| 为什么选这个技术 | `docs/选型说明.md` |
| 修复了哪些 bug | `docs/开发文档.md` → Part 0.3 |
| 最近做了什么变更 | `openspec/changelog/` |
| 新功能设计 | `openspec/add/` |
| 架构改动 | `openspec/change/` |
