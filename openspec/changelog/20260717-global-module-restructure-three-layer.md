# 变更日志：模块重组为「三层分组 + 垂直特性切片」

**日期**：2026-07-17
**项目缩写**：global（跨全项目，主要影响 backend）
**类型**：重构

## 变更摘要

将 `app/src/` 从 20 个扁平顶层目录重组为 `core / infra / features / entry` 四层结构，并引入 `@core/* @infra/* @features/* @entry/*` 路径别名。零 API/协议变更，纯结构性位移。

## 变更详情

### 为什么改

`app/src/` 128 个 TS 文件、~11,660 行代码、20 个平级顶层目录混合了三种关注点（内核基础设施 / 平台适配器 / 业务能力），导致：

1. 业务能力没有「一等公民」物理位置。一个 Excel 特性散在 `parser/excel-parser.ts` + `tools/excel/*` + `skills/excel-*` + `routes/excel.ts` + `analyze/duckdb-service.ts` 共 6 个目录。
2. `routes/` 无序增长（18 文件 / 2349 LOC），路由与对应业务逻辑物理分离。
3. 加新功能没有"正确位置"直觉。Phase 3 待加的 PDF/Word、MCP、GraphRAG、多租户每个都要切 4~6 个目录。

### 改成什么样

**Before**：`config/ db/ cache/ ... kg/ routes/ ws/` 20 个扁平目录混在一起，依赖方向杂乱。

**After**：
```
app/src/
├── core/      内核：config · db · cache · redis · utils · shared
├── infra/     平台基础设施：llm · embedding · storage · hooks · settings · auth
├── features/  业务能力（垂直切片，一等公民）：kb · chat · excel · kg · admin
└── entry/     组装根：index · worker · routes
```

依赖方向单向：`entry → features → infra → core`。跨模块 import 一律使用路径别名 `@core/* @infra/* @features/* @entry/*`，feature 内部相对引用保留 `./`。

### 执行方法

- **物理迁移**：`git mv` 整块移动，保留 git 历史。共迁移 88 个 src 文件 + 14 个 test 文件。
- **import 重写**：Python 脚本（v1/v2/v3 三版）按"老模块前缀 → 别名"做正则替换。v1 处理静态 `from '../X'`，v2 处理 tests/ 的 `from '../src/X'`，v3 处理动态 `await import('../X')` 与 inline 类型 `import('../X').Y`。
- **手工修复**：12 个边界情况（entry 文件 `./X` 改别名、tools/excel 路径去重、跨 feature `../types` 引用等）。

### 已知技术债（留作后续独立 change）

1. **`features/kb/tools/index.ts` 仍 import `@features/chat/tools/call-agent`** —— kb→chat 的跨 feature 引用，违反严格分层。根因：`createToolRegistry` 的 `includeCallAgent` 选项。后续应把 callAgentTool 注册移到 `entry/composition.ts`，从 kb tools 移除该选项。
2. **`features/excel/tools/*` 仍 import `@features/kb/tools/types`** —— excel→kb 的跨 feature 引用。根因：`Tool / ToolContext` 类型未上提到 `core/shared/`。后续应把共享 Tool 类型抽到 `core/shared/tool-types.ts`。
3. **`features/kb/pipeline/document-reset.ts` import `@entry/worker`** —— feature→entry 反向引用。根因：`ingestQueue` 定义与 `startWorker` 都在 entry/worker.ts。后续应把 `ingestQueue` 拆到 `features/kb/pipeline/queue.ts`，entry/worker.ts 只做 Worker 启动。
4. **Excel routes 687 LOC 单文件** —— 整块搬到 `features/excel/routes/index.ts`，未按资源拆 sub-router。
5. **`utils/` 仍是混合抽屉** —— 后续按 feature 内聚下沉。

## 影响的文件/模块

| 文件/模块 | 变更类型 | 说明 |
|----------|---------|------|
| `app/src/` 全部 128 个 TS 文件 | 修改 | 物理位置变化 + import 路径重写为别名 |
| `app/src/{core,infra,features,entry}/` | 新增（目录） | 四层骨架 |
| `app/src/{config,db,cache,redis,utils,...}/` | 删除（旧位置） | 20 个旧顶层目录全部迁出 |
| `app/tests/*.ts` | 修改 | 14 个测试文件 import 重写为别名 |
| `app/tsconfig.json` | 修改 | 新增 `baseUrl` + `paths`（@core/@infra/@features/@entry）|
| `app/package.json` | 修改 | `dev`/`start`/`worker` 脚本路径 → `src/entry/*` |
| `app/drizzle.config.ts` | 修改 | `schema`/`out` 路径 → `src/core/db/*` |
| `PROJECT.md` | 修改 | 后端模块表按四层重组 |
| `AGENTS.md` | 修改 | 文件结构段更新 |
| `README.md` | 修改 | 项目结构段更新 |
| `docs/知识库设计.md` | 修改 | 第四章目录结构重写 |
| `openspec/change/20260717-global-module-restructure-three-layer.md` | 新增 | 本次架构改动设计文档 |

## 相关设计文档

- [`openspec/change/20260717-global-module-restructure-three-layer.md`](../change/20260717-global-module-restructure-three-layer.md) —— 完整的 Before/After 映射表、迁移计划、风险评估、回滚方案

## 验证方式

- [x] `bun run typecheck` —— **0 个迁移相关错误**（TS2307 Cannot find module）。剩余 12 个错误经 `git stash` 对照验证为 **pre-existing**（excel 代码 + tests 的 strict 模式问题，与本次迁移无关）。
- [x] `bun test` —— 67 pass / 13 fail。13 个失败全部是 `tests/e2e-legal.test.ts` 的 E2E 测试（需连运行中的 kc-app Docker 容器 + 有效 auth token）；经 `git stash` 在原始代码上跑同一文件，**0 pass / 13 fail 同样失败**，确认为 pre-existing 环境问题。
- [x] 路径别名生效：`@core/* @infra/* @features/* @entry/*` 在 tsc + Bun 运行时均能解析。
- [ ] **未做**：`bun run dev` 实启动 + `curl /health` 冒烟 + WS 问答 + Excel + KG 端到端验证。原因：当前 Docker 里跑的是旧构建的 kc-app 容器，需要重建镜像或停容器后用 `bun run dev` 启动新代码。**合并前请手动跑一次冒烟**。

## 后续工作

- [ ] 手动冒烟测试（`bun run dev` + `bun run worker` + 浏览器登录 + Chat/Excel/KG 各跑一次）
- [ ] 清理技术债 #1：call-agent 从 kb tools 抽出到 entry composition
- [ ] 清理技术债 #2：Tool/ToolContext 类型上提到 core/shared
- [ ] 清理技术债 #3：ingestQueue 拆到 features/kb/pipeline/queue.ts
- [ ] Excel routes 按资源拆 sub-router
- [ ] dependency-direction 编译期校验（ESLint rule 或自写脚本）
