# 变更日志：多智能体架构 + 管理后台

**日期**：2026-07-03
**项目缩写**：global
**类型**：功能新增 | 架构改动

## 变更摘要

实现多智能体架构 + Web 管理后台（SPA），让 KB-Core 从单 Agent 升级为"主 Agent + 领域专业子 Agent"的可配置架构。前端提供完整的文档/Skill/智能体管理、切片查看、流式问答。

## 变更详情

### 1. 数据库

- 新增 `agents` 表：存储子智能体配置（name/systemPrompt/datasetIds/skillNames/personality/enabled）
- 新增 `skill_definitions` 表：存储 Skill（name/tools/parameters/instructions/version）
- 写手工 SQL migration: `manual_add_agents_and_skills.sql`
- 启动时自动 seed：扫描 SKILL.md 文件 → 写入 skill_definitions；写入 3 个预置 agents

### 2. Agent 层

- `MainAgent`：主调度器，LLM 自主决策调用 `call_agent` 分发问题
- `SubAgentRegistry`：管理所有子 Agent 实例，支持热重载
- `call_agent` tool：Main Agent 调用子 Agent 的工具接口
- `QueryAgent.executeWithSystemPrompt()`：注入自定义 system_prompt
- `buildSystemPrompt()`：支持子 Agent 列表注入到主 Agent prompt

### 3. 数据层多 dataset 支持

- `RetrieveOptions.datasetIds: readonly string[]` 支持多数据集并行检索
- `denseSearch` / `sparseSearch` / `retriever` 全部支持 `datasetIds`
- `ToolContext.datasetIds` 传递到所有工具
- 缓存 key 改为多 ID 拼接

### 4. REST API（新增 5 个路由模块 + reload 端点）

- `/api/agents` CRUD（含 validation、自动 reload subAgentRegistry）
- `/api/skills` CRUD（含版本自增）
- `/api/documents` 列表 + 详情 + 原文 + 切片 + 删除（软） + 重切割
- `/api/datasets` 列表 + 创建
- `/api/stats` Dashboard 统计
- `POST /api/reload` 手动热重载 sub-agents

### 5. SkillLoader 改造

- 完全从 DB 读取 skills，不再依赖文件系统作为真相
- 启动时 DB 为空自动从文件迁移种子到 DB（一次性）
- `SkillRegistry.reload()` 支持运行时热加载

### 6. 前端 SPA（status/）

纯 HTML + 原生 JS + CSS，hash 路由：

- `#/` — Dashboard：文档数/切片数/查询数/数据集分布
- `#/agents` — 智能体管理：列表 + 创建/编辑 modal（含 system_prompt 大文本 + datasetIds 多选）
- `#/skills` — Skill 管理：列表 + 创建/编辑 modal（含 instructions 编辑 + 实时 md 预览 + parameters JSON Schema）
- `#/documents` — 文档列表：工具栏（上传 / 刷新 / 重新嵌入 / 删除）+ 数据集/状态筛选
- `#/documents/:id` — 文档详情：原文左栏（切片高亮 + 点击定位） + 切片列表右栏（含所有参数）
- `#/chat` — 流式问答：自动智能体路由 + 工具调用进度 + citations + 高级参数折叠

### 7. 静态服务

- `src/index.ts` 使用 hono `serveStatic` 挂载 `/status/*` 和 `/` 路由
- 从 `/home/mingjie-li/code/KB-Core/status/` 提供静态资源

## 影响的文件/模块

| 文件 | 变更 |
|------|------|
| `src/db/schema/agents.ts` | 新增 |
| `src/db/schema/skill-definitions.ts` | 新增 |
| `src/db/schema/index.ts` | 修改（export） |
| `src/db/migrations/manual_add_agents_and_skills.sql` | 新增 |
| `src/db/seed.ts` | 新增（skills + agents 种子脚本） |
| `src/agent/main-agent.ts` | 新增 |
| `src/agent/sub-agent-registry.ts` | 新增 |
| `src/agent/query-agent.ts` | 修改（加 executeWithSystemPrompt + datasetIds 传递） |
| `src/agent/system-prompt.ts` | 重写（支持子 Agent 列表 + custom prompt） |
| `src/agent/types.ts` | 修改（QueryOptions 加 datasetIds） |
| `src/tools/call-agent.ts` | 新增 |
| `src/tools/index.ts` | 修改（支持 includeCallAgent 选项） |
| `src/tools/types.ts` | 修改（ToolContext 加 datasetIds） |
| `src/tools/search-knowledge.ts` | 修改 |
| `src/tools/get-document.ts` | 修改 |
| `src/tools/list-documents.ts` | 修改 |
| `src/retrieve/dense.ts` | 修改（多 datasetIds + resolveDatasetIds 工具函数） |
| `src/retrieve/sparse.ts` | 修改 |
| `src/retrieve/retriever.ts` | 修改 |
| `src/skills/loader.ts` | 重写（from DB） |
| `src/skills/registry.ts` | 修改（reload + register） |
| `src/skills/types.ts` | 修改（SkillContext 加 datasetIds） |
| `src/routes/agents.ts` | 新增 |
| `src/routes/skills.ts` | 新增 |
| `src/routes/documents.ts` | 新增 |
| `src/routes/datasets.ts` | 新增 |
| `src/routes/stats.ts` | 新增 |
| `src/routes/index.ts` | 新增（mountApiRoutes） |
| `src/index.ts` | 重大改造（migration+seed+SubAgentRegistry+MainAgent+静态服务+路由挂载） |
| `status/index.html` | 新增 |
| `status/css/style.css` | 新增（397 行简洁主题） |
| `status/js/app.js` | 新增（hash 路由） |
| `status/js/api.js` | 新增（fetch wrapper + ws） |
| `status/js/components/sidebar.js` | 新增 |
| `status/js/components/modal.js` | 新增 |
| `status/js/components/table.js` | 新增（可分页表格） |
| `status/js/pages/dashboard.js` | 新增 |
| `status/js/pages/agents.js` | 新增 |
| `status/js/pages/skills.js` | 新增 |
| `status/js/pages/documents.js` | 新增 |
| `status/js/pages/doc-detail.js` | 新增 |
| `status/js/pages/chat.js` | 新增 |

## 验证方式

- [x] `bun run typecheck` 0 errors
- [x] 现有 26/26 单元测试全 pass
- [x] 服务启动成功（health / stats / agents API 返回正常）
- [x] DB 自动迁移 + seed（3 agents + 6 skills）
- [x] WebSocket 多智能体路由实测：用户问"员工迟到，可以扣工资吗？" → 主 Agent 调用 call_agent(mediation) → mediation sub-agent 检索劳动法返回
- [x] 所有 REST API 手动验证（agents/skills/documents/datasets/stats）
- [x] Validation fail 返回 400 + 明确错误消息
- [x] 静态资源（HTML/CSS/JS）从 /status/* 正确提供

## 后续工作（Phase 4）

- [ ] Chat 增加 streaming trace 可视化（看每个 Agent step 的细节）
- [ ] 评估框架 API + 前端
- [ ] 多租户（owner_id 隔离）
- [ ] 用户/权限
- [ ] PDF/Word parser
- [ ] 自定义 Skill 注册（UI 拖拽参数 Schema）
