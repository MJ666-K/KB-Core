# 变更日志：私有库多租户 — Step 1 Schema + 迁移 + Seed

**日期**：2026-08-21
**项目缩写**：global
**类型**：功能新增

## 变更摘要

实现「私有库 + 多库多智能体」架构改动的第 1 步：datasets/agents 表多租户化（加 ownerId/visibility + 库级配置 jsonb）、新建 dataset_members ACL 表、新增 `datasets:read`/`datasets:manage` 权限、迁移 0005（安全回填存量库/智能体 owner=超管 + visibility=public）、seed 顺序调整并补 owner/visibility。

## 变更详情

### 数据模型
- `datasets` 加 `ownerId`(uuid FK→users.id, NOT NULL)、`visibility`(enum private/shared/public, default private)、`chunkConfig`/`retrieveConfig`(jsonb Partial 覆盖)、`updatedAt`；`name` 由全局 unique 改为 `(ownerId, name)` 联合唯一（允许多租户同名私有库）。
- 新建 `dataset_members` 表（datasetId+userId 复合主键, role viewer/editor/manager, grantedBy, createdAt）支撑 visibility='shared' 的细粒度共享；datasetId 级联删除，userId RESTRICT。
- `agents` 加 `ownerId`/`visibility`（复用 dataset_visibility enum，当前仅启用 private/public，shared 预留二期）；`name` 改 `(ownerId, name)` 联合唯一。`datasetIds` 语义不变（智能体声明的服务库）。
- `documents.scope`/`chunks.scope` 语义将改为 `dataset.visibility` 冗余标签（入库时带，Step 5 实现）；检索隔离主键仍是 `datasetId`。

### 权限
- 新增 `datasets:read`（用库功能/建私有库/选库问答/入库到自己有写权限的库）、`datasets:manage`（管理任意库）。
- 角色 seed：`user` 补 `datasets:read`；`admin`/`superadmin` 补 `datasets:manage`。
- 智能体行级（owner/public 两级，`agentVisibleToUser`）+ 库行级（private/shared/public + members，`resolveDatasetAccess`）将在 Step 3 实现。

### 迁移 0005
安全顺序：owner_id 先 nullable 加列 → UPDATE 回填（owner=超管 + visibility=public 存量行）→ SET NOT NULL → FK + 联合 unique + 索引。全新部署表空时回填影响 0 行，SET NOT NULL 安全。

### Seed
`runBaseSeed` 顺序调整为 roles → ensurePermissions → seedSuperAdmin（前置，库/智能体需 owner）→ datasets → models → skills → agents。seedDatasets/seedAgents 查超管 id 作 owner，onConflict target 改联合 unique。

### 连带适配（让 typecheck 通过，行级校验留后续 Step）
- `routes/datasets.ts`、`routes/ingest.ts`、`routes/agents.ts`、`kg/ingest.ts` 的 insert 补 ownerId（HTTP 路由从 token 用户取，kg 从超管取）。仅最小适配，未实现行级权限逻辑（Step 4/5/6）。

## 影响的文件/模块

| 文件/模块 | 变更类型 | 说明 |
|----------|---------|------|
| `app/src/db/schema/dataset.ts` | 修改 | 扩 5 字段 + 联合 unique + 2 接口类型 |
| `app/src/db/schema/dataset-member.ts` | 新增 | ACL 成员表 |
| `app/src/db/schema/agents.ts` | 修改 | 加 ownerId/visibility + 联合 unique |
| `app/src/db/schema/index.ts` | 修改 | 导出新表/enum/类型 |
| `app/src/auth/permission-registry.ts` | 修改 | +2 权限 + label/desc/group |
| `app/src/db/seed/presets.ts` | 修改 | 角色补权限 + interface 加 visibility? |
| `app/src/db/seed/run.ts` | 修改 | seed 顺序 + 带 owner/visibility + 联合 onConflict |
| `app/src/db/migrations/0005_private_datasets_multi_agent.sql` | 新增 | 迁移 + snapshot |
| `app/src/routes/datasets.ts` `ingest.ts` `agents.ts` | 修改 | insert 补 ownerId（最小适配） |
| `app/src/kg/ingest.ts` | 修改 | kg 建库补超管 owner + public |
| `openspec/change/20260821-global-private-datasets-multi-agent.md` | 新增 | 架构改动设计文档 |

## 相关设计文档

- `openspec/change/20260821-global-private-datasets-multi-agent.md`（8 步实现计划，本步为 Step 1）

## 验证方式

- [x] typecheck 通过（`tsc --noEmit`）
- [x] db:migrate 通过（0000-0005 全部应用，dataset_members 表 + owner_id/visibility/chunk_config/retrieve_config/updated_at 字段 + 2 enum）
- [x] seed 通过（3 角色 / 2 库 / 5 模型 / 8 技能 / 5 智能体；owner=超管、visibility=public 回填正确；权限 datasets:read/manage 按角色正确分配）

## 后续工作

- [ ] Step 2：配置覆盖层（mergeChunk/mergeQuery + retriever/splitter 接收显式 cfg）
- [ ] Step 3：行级权限辅助（resolveDatasetAccess + agentVisibleToUser + accessibleDatasetIds）
- [ ] Step 4：datasets 路由 CRUD + 成员管理
- [ ] Step 5：documents/ingest/pipeline 接入行级 + 配置
- [ ] Step 6：agents 路由多租户化
- [ ] Step 7：多库多智能体链路（WS + MainAgent + call-agent 交集修复）
- [ ] Step 8：前端（Datasets 页 + Chat 多选库 + Documents/Agents/权限）
