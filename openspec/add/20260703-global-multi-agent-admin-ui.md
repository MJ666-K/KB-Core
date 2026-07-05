# 功能设计：多智能体架构 + 管理后台

**日期**：2026-07-03
**项目缩写**：global
**状态**：确认

## 背景

当前 KB-Core 是单智能体（QueryAgent），所有问题用同一套 system_prompt + 同一数据池处理。业务需求：
1. **多领域**：基层调解（劳动争议/调解仲裁）、企业法务（公司法务/合同/合规）、通用 QA，各有人设和数据隔离
2. **Skill 动态管理**：前端增删改查，立即生效，无需重启或写文件
3. **配置化管理**：切片参数、问答参数、重切割/重向量化，都应在前端有（不起眼的）配置面板
4. **文档全链路可见**：原文查看 + 切片高亮 + 切片参数可见
5. **自动路由**：用户问答不选 agent，主 Agent 根据意图自动分发

## 需求

- [x] 新增 `agents` 表，存储 3 个预置智能体
- [x] 新增 `skill_definitions` 表，替代文件加载（无文件兜底）
- [x] 启动时自动迁移文件 SKILL.md → DB（如 DB 没有该 skill）
- [x] Main Agent → Sub-Agent 架构，LLM function calling 路由
- [x] `call_agent(name, question)` 工具，子 Agent 数据层隔离
- [x] 完整 REST API：agents / skills / documents / datasets CRUD
- [x] 文档 API：原文查看 + 切片列表（含完整参数：parentChunkIndex、childIndex、tokenCount、embedding_status）
- [x] 重切割 + 重向量化 API
- [x] 前端 SPA（纯 HTML/JS/CSS）：5 个页面（Dashboard / Agents / Skills / Documents / Chat）
- [x] 文档详情页：原文 + 切片联动高亮
- [x] 问答页：流式 + 自动意图拆分 + 高级参数（收起状态）

## 技术方案

### 1. 数据库 Schema

**`skill_definitions` 表**
```sql
CREATE TABLE skill_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  tools TEXT[] NOT NULL DEFAULT '{}',
  parameters JSONB NOT NULL DEFAULT '{}',
  instructions TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);
```

**`agents` 表**
```sql
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  dataset_ids UUID[] NOT NULL DEFAULT '{}',
  skill_names TEXT[] DEFAULT '{}',
  personality TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**预置数据**：
- 3 个 agents：`general`（通用 QA）、`mediation`（基层调解）、`corporate`（企业法务）
- 6 个 skills（从文件迁移）：qa / compare / search / summary / chat / multihop

### 2. Agent 层重构

```
MainAgent (Orchestrator)
  ├─ system_prompt: 路由策略 + 可用子 Agent 列表（动态从 agents 表读）
  ├─ tools: [call_agent(name, question, topK, maxIterations, ...)]
  └─ 调用子 Agent 时传入 datasetIds + 子 Agent system_prompt

SubAgent (QueryAgent 实例)
  ├─ 自定义 system_prompt（来自 agents 表）
  ├─ 数据层隔离：检索时 where dataset_id IN (dataset_ids)
  └─ 共享 Skill/Tool 层（Skill 按 skill_names 过滤，空=全量）
```

新增文件：
- `src/agent/sub-agent-registry.ts`：管理 SubAgent 实例，热加载
- `src/tools/call-agent.ts`：call_agent 工具
- `src/agent/main-agent.ts`：MainAgent，组合 call_agent + 子 Agent

改造：
- `QueryAgent` 保持原样，作为 SubAgent 使用
- 新增 `QueryOptions.datasetIds: string[]`（数组，支持多 dataset）
- `HybridRetriever` 支持多 dataset 过滤

### 3. Skill 加载改造

`SkillLoader` 改为从 DB 读取：
- 启动时：如 DB 为空，扫描 `src/skills/*/SKILL.md`，写回 DB
- 运行期：从 DB 加载 enabled=true 的 skill
- CRUD API 修改 DB 后立即生效（registry 监听变化或每次查询时 reload）

### 4. API 路由

| Method | Path | 用途 |
|--------|------|------|
| GET/POST | `/api/agents` | 列表 / 创建 |
| GET/PUT/DELETE | `/api/agents/:name` | 详情 / 更新 / 删除 |
| POST | `/api/agents/reload` | 运行时热加载 |
| GET/POST | `/api/skills` | 列表 / 创建 |
| GET/PUT/DELETE | `/api/skills/:name` | 详情 / 更新 / 删除 |
| GET | `/api/documents` | 列表（分页+dataset+status） |
| GET | `/api/documents/:id` | 详情 |
| GET | `/api/documents/:id/content` | 原文 |
| GET | `/api/documents/:id/chunks` | 切片列表 |
| DELETE | `/api/documents/:id` | 软删 |
| POST | `/api/documents/:id/reingest` | 重切割+重向量化 |
| GET/POST | `/api/datasets` | 列表 / 创建 |
| GET | `/api/stats` | Dashboard 统计 |

### 5. WebSocket 增强

请求增加字段（高级参数，前端默认折叠）：
```json
{
  "type": "query",
  "question": "...",
  "options": {
    "topK": 5,
    "maxIterations": 5,
    "temperature": 0.2,
    "rerankTopK": 20
  }
}
```

响应已支持流式（thinking/step/token）。

### 6. 前端 SPA 结构

```
status/
├── index.html
├── css/style.css
└── js/
    ├── app.js         (hash 路由)
    ├── api.js         (fetch wrapper)
    └── pages/
        ├── dashboard.js
        ├── agents.js
        ├── skills.js
        ├── documents.js
        ├── doc-detail.js  (原文+切片联动高亮)
        └── chat.js        (流式问答，自动选 agent)
```

**文档详情页**：左原文（用 chunk startOffset/endOffset 定位高亮），右切片列表，点击切片滚动原文到对应位置并高亮。切片显示所有参数（id / parentChunkIndex / childIndexWithinParent / tokenCount / embedding_status / startOffset）。

**问答页**：
- 不暴露 agent 选择，根据意图自动路由
- 默认折叠"高级参数"区：topK / maxIterations / temperature / datasetId
- 实时流式显示 thinking / tool_call / 答案 token

## 影响范围

| 模块 | 变更 |
|------|------|
| DB | 新增 2 表 + 1 迁移文件 |
| src/agent/ | 新增主 Agent + SubAgentRegistry + call_agent 工具 |
| src/skills/ | loader 改从 DB 读 + 启动迁移 |
| src/retrieve/ | retriever 支持多 datasetId |
| src/routes/ | 新增 5 个路由模块 |
| src/index.ts | 静态服务 + 组装新 Agent |
| status/ | 全新 SPA（6 页面） |

## 测试计划

- [x] `bun run typecheck` 0 errors
- [x] `bun test` 26/26 单元测试通过
- [x] DB 迁移 + 数据种子脚本
- [x] API 集成测试（agents/skills/documents 各 CRUD）
- [x] 手动验证流式问答 + 自动路由
- [x] 前端浏览器打开 5 个页面都能交互

## 时间估算

4 个并行子 Agent：
- A：Schema + Migration + MainAgent refactor（依赖 DB）
- B：所有 /api/* routes（依赖 DB）
- C：前端骨架 + 通用组件 + dashboard/agents/skills 页
- D：前端 documents + doc-detail + chat 页

总计约 2-3 个并行 agent 周期（20-35 分钟），最后集成测试 + changelog。
