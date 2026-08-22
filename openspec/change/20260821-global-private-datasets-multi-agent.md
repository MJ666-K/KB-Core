# 架构改动：私有库（多租户）+ 多库多智能体问答

**日期**：2026-08-21
**项目缩写**：global
**状态**：实现中

## 改动原因

当前系统是单租户共享模型，存在三类痛点：

1. **datasets 表无多租户字段**：只有 id/name/description/kind/createdAt，没有 ownerId/visibility。任何有 `documents:read` 的用户能列出全部库，任何有 `documents:write` 的用户能给任意库入库——存在越权风险。无法实现「用户创建自己的私有库」。
2. **配置全局单例**：`data/settings.json` 是全局 chunk/query 参数，splitter/retriever 都从全局读，不能按库配置切割/召回策略。
3. **多库多智能体链路断裂**：主聊天 WS 回退 `'default'` 库（单值），前端 Chat 不选库；`call-agent.ts:51` 忽略 `ctx.datasetIds`，子智能体只用 `agents` 表配置的库，用户选的库传不进检索。无法「选多个库 + 用这些库的智能体」。

用户需求：用户可创建私有库，按库配置切割/召回策略；Chat 可多选库，调用这些库关联的智能体回答。

## 改动方案

### Before（现状）

- `datasets`：name 全局 unique，无 owner/visibility/config。
- `agents`：name 全局 unique，无 owner/visibility；datasetIds 是智能体声明的服务库（全局配置，与请求无关）。
- 配置：`settings.json` 全局单例，`getChunkSettings()/getQuerySettings()` 同步读全局。
- 权限：11 项 RBAC，无 datasets 专属权限，无行级所有权。
- 聊天：WS `resolveDatasetId` 回退 `default` 库；前端不传 datasetId；`call-agent.ts` 用 `metadata.datasetIds` 忽略 `ctx.datasetIds`。
- 前端：无 Datasets 页面，库只在 Documents 上传、Agents 表单被消费。

### After（目标）

**数据模型**：
- `datasets` 加 `ownerId`(uuid FK→users.id)、`visibility`(enum private/shared/public)、`chunkConfig`(jsonb)、`retrieveConfig`(jsonb)、`updatedAt`；name 改为 `(ownerId,name)` 联合唯一。
- 新建 `dataset_members` 表（datasetId,userId,role viewer/editor/manager）支撑 shared 库 ACL。
- `agents` 加 `ownerId`、`visibility`（复用 dataset_visibility enum，当前仅启用 private/public，shared 预留二期）；name 改为 `(ownerId,name)` 联合唯一。
- `documents.scope`/`chunks.scope` 语义改为 `dataset.visibility` 冗余标签（入库时带过来，替代硬编码 `'platform'`）；**检索隔离主键仍是 `datasetId`**。

**配置覆盖**：保留 `settings.json` 全局默认，库级 `chunkConfig/retrieveConfig` 覆盖；`mergeChunk/mergeQuery` 合并函数；splitter/retriever 由调用方在已查到 dataset 后显式传入合并后的 cfg（不让同步 settings 层查 DB）。多库检索取主库（datasetIds[0]）的 retrieveConfig。

**权限模型**：RBAC（功能）+ 行级所有权（数据）两层 AND。
- 新增权限：`datasets:read`（用库功能/建私有库）、`datasets:manage`（管理任意库，超管/admin）。
- 行级判定（`resolveDatasetAccess`）：owner→manage；shared member 按 role；public→read；其他→none。
- 智能体行级（`agentVisibleToUser`）：owner→manage；public→read；private 非 owner→none（两级，shared 预留）。
- user 角色补 `datasets:read`；admin/superadmin 补 `datasets:manage`。

**多库多智能体链路**：
- 前端 Chat 多选库 → WS `datasetIds` 数组。
- WS 校验用户对每个库有 read 权限。
- `MainAgent` 过滤「可用智能体」= `agents.datasetIds` 含所选库 且 用户可见。
- `call-agent.ts` 修复：检索范围 = `ctx.datasetIds ∩ metadata.datasetIds`（交集），确保只检索用户授权库；未选库时用智能体配置（兼容）。
- 协作模式：主智能体路由单个子智能体（复用枫桥规则 + LLM 自主 `call_agent`）；未命中智能体回退跨多库统一检索。

**路由**：
- datasets 补全 CRUD + 成员管理（GET/POST/PUT/DELETE + `/members`）。
- documents/ingest 按 `accessibleDatasetIds` 过滤 + write 校验。
- pipeline 传 chunkConfig、scope 赋 visibility。
- WS query 多 datasetIds 校验 + query-job 存 datasetId。

**前端**：
- 新增 Datasets 页面（列表/创建/编辑/删除/成员管理）。
- Settings 抽共享表单组件，保留为全局默认。
- Chat 加多选库 Select；Documents 上传只列有 write 权限的库；Agents 多租户视角。
- 权限常量 + 菜单 + 路由同步。

## 影响范围

### 受影响的模块

| 模块 | 影响程度 | 说明 |
|------|---------|------|
| db/schema | 重大 | datasets/agents 扩字段 + 新建 dataset_members |
| auth | 重大 | +2 权限 + 行级判定辅助 |
| settings/retrieve/splitter | 中等 | 配置覆盖 + 显式 cfg |
| routes | 重大 | datasets CRUD + documents/ingest 行级校验 |
| pipeline | 中等 | 传 chunkConfig + scope |
| ws/agent/tools | 重大 | 多库多智能体链路 |
| 前端 | 重大 | 新页面 + Chat/Documents/Agents/权限改造 |

### 受影响的接口/协议

| 接口/协议 | 变更类型 | 说明 |
|----------|---------|------|
| `GET/POST/PUT/DELETE /api/datasets[/:id]` | 新增/修改 | 补全 CRUD + 行级校验 |
| `/api/datasets/:id/members` | 新增 | 成员管理 |
| `POST /ingest` | 修改 | 目标库 write 权限校验 |
| WS `/ws/query` | 修改 | 支持 datasetIds 数组 + 权限校验 |
| `GET /api/documents` | 修改 | 按 accessibleDatasetIds 过滤 |
| `GET/PUT /api/settings` | 保留 | 仍为全局默认（语义不变） |

## 迁移计划

1. 迁移 0005：建 `dataset_visibility`/`dataset_member_role` enum；datasets 加 5 列（nullable→回填→NOT NULL）；删 name 全局 unique 建 `(owner_id,name)` 联合；建 dataset_members 表；agents 加 2 列 + 改 unique。
2. 存量回填：`default`/`legal` 库 owner=超管 id、visibility=public、config=null；存量智能体 owner=超管、visibility=public（行为不变）。
3. seed：`runBaseSeed` 调整顺序（seedSuperAdmin 前置），seedDatasets/seedAgents 带 owner+visibility。
4. 角色权限：`ensurePresetRolePermissions` 给 user 补 `datasets:read`、admin 补 `datasets:manage`。
5. 前端权限常量 + 菜单同步。

## 风险评估

| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|---------|
| name 全局 unique→联合 unique 破坏存量 | 中 | 中 | 迁移先删约束再建联合；存量库 owner 回填后无冲突 |
| NOT NULL 列加到有数据表失败 | 中 | 高 | 迁移用 nullable→回填→SET NOT NULL 安全顺序 |
| call-agent 交集逻辑改变子智能体行为 | 中 | 中 | 未选库时回退原配置（兼容）；集成测试覆盖 |
| 缺 snapshot 导致下次 generate 困惑 | 低 | 低 | 遵循 0002/0003 手写惯例；后续 generate 前可补 snapshot |

## 回滚方案

- 回滚迁移：执行 0005 的反向 SQL（删 dataset_members、删 enum、删列、恢复 name unique）。
- 回滚代码：`git revert` 对应提交。
- 数据回滚：visibility 改回无（列删除）；owner_id 列删除。存量数据未物理修改（仅补字段值），回滚安全。

## 验证方式

- [ ] typecheck 通过
- [ ] db:migrate 通过（存量库/智能体回填正确）
- [ ] seed 幂等执行通过（角色权限补齐）
- [ ] 后续 Step 集成测试覆盖行级权限、多库检索、智能体交集

## 实现步骤

分 8 步渐进实现，每步测试通过再下一步：

1. **Schema + 迁移 + seed**（本步）
2. 配置覆盖层（merge* + retriever/splitter 显式 cfg）
3. 行级权限辅助（resolveDatasetAccess + agentVisibleToUser + accessibleDatasetIds）
4. datasets 路由 CRUD + 成员
5. documents/ingest/pipeline 接入行级 + 配置
6. agents 路由多租户化
7. 多库多智能体链路（WS + MainAgent + call-agent 交集）
8. 前端（Datasets 页 + Chat 多选库 + Documents/Agents/权限）
