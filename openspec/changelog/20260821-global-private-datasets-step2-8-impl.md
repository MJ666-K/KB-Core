# 变更日志：私有库多租户 — Step 2-8 实现层

**日期**：2026-08-21
**项目缩写**：global
**类型**：功能新增

## 变更摘要

在 Step 1（Schema + 迁移 + Seed）基础上，完成私有库多租户 + 多库多智能体的实现层：配置覆盖层、行级权限辅助、datasets/agents 路由多租户化、documents/ingest/pipeline 接入行级与配置、多库多智能体问答链路（WS + MainAgent + call-agent 交集修复）、前端 Datasets 页 + Chat 多选库。

## 变更详情

### Step 2 配置覆盖层
- `settings/effective-config.ts`：新增 `mergeChunk/mergeQuery` + `ChunkSettings/QuerySettings` 类型。保留全局默认 `getChunkSettings/getQuerySettings`。
- `retrieve/retriever.ts`：`RetrieveOptions` 加 `cfg?: QuerySettings`；`retrieve/retrieveWithDetails` 用 `opts.cfg ?? getQuerySettings()`（库级覆盖全局）。
- `tools/search-knowledge.ts`：查主库（datasetIds[0] ?? datasetId）的 `retrieveConfig` → `mergeQuery` → 传 cfg。
- `pipeline/ingest-pipeline.ts`：查库 `chunkConfig` → `mergeChunk` → `createSplitterWithConfig`；chunk 写入 `scope = ds.visibility`（替代硬编码 `'platform'`）。

### Step 3 行级权限辅助（`auth/access.ts` 新增）
- `resolveDatasetAccess(dataset, userId, isSup)`：owner→manage / public→read / shared 按 member role / private 非 owner→none。
- `resolveAgentAccess` + `agentVisibleToUser`：owner→manage / public→read / private 非 owner→none（两级，shared 预留）。
- `accessibleDatasetIds(userId, isSup)`：用户可读的全部库 id（owner + public + shared member），用于文档列表过滤。
- `isSuperadminUser` / `hasAccessLevel`。

### Step 4 datasets 路由 CRUD + 成员（`routes/datasets.ts` 重写）
- GET / 列出用户可访问的库（超管全部；否则 owner+public+shared member）。
- GET/PUT/DELETE /:id + POST / + GET/POST/PUT/DELETE /:id/members，全部行级校验（read/manage）+ zod 校验 body。
- `loadDatasetFor` helper 统一「param 守卫 + 查库 + 行级校验」。

### Step 5 documents/ingest/pipeline 行级 + 配置
- `routes/documents.ts`：GET / 按 `accessibleDatasetIds` 过滤；GET/DELETE/reingest 用 `loadDocForAccess` 行级 read/write 校验。
- `routes/ingest.ts`：`resolveIngestDataset`（uuid 优先按 id 查，否则 owner+name 查/建私有库）+ 行级 write 校验；document insert 写 `scope=dataset.visibility` + `ownerId=user.id`。

### Step 6 agents 路由多租户化（`routes/agents.ts` 重写）
- 路由改 `:id`（uuid）；权限 `canUseAgents = agents:manage 或 datasets:read`（owner 可建自己的）。
- GET / 列出可见智能体（owner+public，超管全部）；GET/PUT/DELETE 行级 read/manage；创建 visibility 默认 private。
- `sub-agent-registry.ts`：`AgentMetadata` 加 `ownerId/visibility`，reload 时加载。

### Step 7 多库多智能体链路
- `ws/query.ts`：schema 加 `datasetIds` 数组；`resolveDatasetIds` 多库 + 逐库 read 校验 + 剔除无权库；未指定回退用户可访问的第一个库（不回退全局 default，避免越权）；`agent.execute` 传 `datasetIds/userId/isSuperadmin`。
- `agent/types.ts`：`QueryOptions` 加 `isSuperadmin`。
- `agent/main-agent.ts`：可用智能体过滤 = `agents.datasetIds` 含所选库 且 `agentVisibleToUser`（owner/public/超管）。
- `tools/call-agent.ts`：**断点修复**——检索范围 = `ctx.datasetIds ∩ metadata.datasetIds`（交集，确保只检索用户授权库）；未选库时用智能体配置（兼容）。

### Step 8 前端
- `types.ts`：Dataset 加 ownerId/visibility/chunkConfig/retrieveConfig/updatedAt/kind + 新 DatasetMember/DatasetChunkConfig/DatasetRetrieveConfig。
- `auth/permissions.ts`：+`datasets:read`/`datasets:manage`（label/group/menu/route + canUseDatasets/canManageDatasets）。
- `api.ts`：+datasets CRUD/members（getDataset/create/update/delete + members CRUD）。
- `App.tsx`：+`/datasets` 路由 + 菜单项（DatabaseOutlined）。
- `pages/Datasets.tsx`（新增）：列表（可见性 tag/类型/操作）+ 创建 Modal + 编辑 Drawer（切割/召回配置 InputNumber）+ 删除 Popconfirm + 成员管理 Modal（shared）。
- `pages/Chat.tsx`：加载用户可访问库 + 多选库 Select（mode multiple）+ WS payload 传 `datasetIds`（默认选第一个）。
- `pages/Documents.tsx`：上传传 `dataset.id`（后端按 id 查 + write 校验）。

## 影响的文件/模块

| 文件 | 变更 |
|------|------|
| `app/src/settings/effective-config.ts` | +mergeChunk/mergeQuery + 类型 |
| `app/src/retrieve/retriever.ts` | +cfg 选项 |
| `app/src/tools/search-knowledge.ts` | 查主库 retrieveConfig + mergeQuery |
| `app/src/pipeline/ingest-pipeline.ts` | mergeChunk + 显式 splitter + scope=visibility |
| `app/src/auth/access.ts` | 新增行级权限辅助 |
| `app/src/routes/datasets.ts` | 重写 CRUD + 成员 + 行级 |
| `app/src/routes/documents.ts` | 行级 read/write + accessibleIds 过滤 |
| `app/src/routes/ingest.ts` | resolveIngestDataset + 行级 write + scope/ownerId |
| `app/src/routes/agents.ts` | 重写 :id 路由 + 多租户 |
| `app/src/agent/sub-agent-registry.ts` | AgentMetadata +ownerId/visibility |
| `app/src/agent/types.ts` | QueryOptions +isSuperadmin |
| `app/src/agent/main-agent.ts` | 可用智能体过滤 |
| `app/src/tools/call-agent.ts` | 交集修复 |
| `app/src/ws/query.ts` | 多库 datasetIds + 权限校验 |
| `app/src/index.ts` | WsData +isSuperadmin |
| `status/src/types.ts` `auth/permissions.ts` `api.ts` | 前端类型/权限/API |
| `status/src/App.tsx` | +/datasets 路由+菜单 |
| `status/src/pages/Datasets.tsx` | 新增知识库管理页 |
| `status/src/pages/Chat.tsx` | 多选库 |
| `status/src/pages/Documents.tsx` | 上传传 id |

## 相关设计文档

- `openspec/change/20260821-global-private-datasets-multi-agent.md`

## 验证方式

- [x] 后端 typecheck 通过（`tsc --noEmit`，strict + noUncheckedIndexedAccess）
- [x] 前端 typecheck 通过
- [x] Step 1 已验证 db:migrate + seed + 数据回填

## 后续工作

- [x] 前端 Agents 页多租户视角（已补：菜单/路由 `/agents` 放开 `datasets:read`/`datasets:manage`；Agents 页加 visibility 选择 + 列表可见性列；写权限 `canUseAgents` = agents:manage ∥ datasets:read∥manage；types Agent 加 ownerId/visibility）
- [ ] Settings 页抽共享表单组件供 Datasets 编辑复用（当前 Datasets 编辑已内联配置表单）
- [ ] 集成测试覆盖：多库检索、行级越权拒绝、call-agent 交集、shared 库成员 ACL
- [ ] 智能体 shared 可见性 + agent_members 表（二期）
