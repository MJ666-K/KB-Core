# 架构改动：模块重组为「三层分组 + 垂直特性切片」

**日期**：2026-07-17
**项目缩写**：global（跨全项目，主要影响 backend）
**状态**：已完成

---

## 改动原因

当前 `app/src/` 是 **20 个平级顶层目录、128 个 TS 文件、~11,660 行代码**，混合了三种本质不同的关注点：

| 关注点类别 | 当前散落位置 |
|---|---|
| 内核基础设施 | `config/` `db/` `cache/` `redis/` `utils/` `models/`（30 LOC，形同虚设）|
| 平台适配器 | `llm/` `embedding/` `storage/` `hooks/` `settings/` `auth/` |
| 业务能力（垂直切片）| `kg/`、`tools/excel/`、`skills/excel-*`、`routes/excel.ts`、`parser/excel-parser.ts`、`analyze/duckdb-service.ts` |

**三大痛点**（有代码证据）：

1. **业务能力没有「一等公民」物理位置**。一个 Excel 特性散在 `parser/excel-parser.ts` + `tools/excel/*`（4 个）+ `skills/excel-analysis/` + `skills/excel-profiling/` + `routes/excel.ts`（687 LOC，单文件最大）+ `analyze/duckdb-service.ts` 共 6 个目录；KG 已经不自觉走对（自己一个 `kg/`）但 Excel 还在按"层"散落。
2. **`routes/` 无序增长**：18 文件 / 2349 LOC，路由和它对应的业务逻辑物理分离。
3. **加新功能没有"正确位置"直觉**。Phase 3 待加：PDF/Word Parser、评估框架、MCP、Query Rewriting、GraphRAG、多租户——按现状每个都要切 4~6 个目录。

**目标**：让"加一个新特性"变成"在 `features/<name>/` 里建子目录 + 在 `entry/routes.ts` 加一行注册"，从结构层面保证可扩展与开发提速。

---

## 改动方案

### Before（现状）

```
app/src/
├── index.ts                    # 单一组合根（DI 全在此）
├── config/  cache/  redis/  utils/  models/          # 内核层（散开）
├── db/                         # schema(14) + migrations + seed
├── llm/  embedding/  storage/  hooks/  settings/     # 平台层
├── auth/                       # JWT + RBAC + query-job-store
├── parser/  splitter/  retrieve/  pipeline/          # KB 数据链路
├── tools/                      # KB tools + tools/excel/*（特性内嵌）
├── agent/  skills/  ws/                            # 查询链路（含所有 skill 种子）
├── kg/                         # 已自成一块
├── analyze/                    # DuckDB（Excel 专用）
└── routes/                     # 18 文件平铺
```

依赖方向杂乱：`routes/excel.ts` 既要 `../tools/excel/*`，又要 `../analyze/duckdb-service`、`../auth/middleware`、`../skills`……

### After（目标）

```
app/src/
├── core/                       # ① 内核：跨业务共用，零业务依赖
│   ├── config/                 # ← config/
│   ├── db/                     # ← db/（schema/migrations/seed 整块迁入，不拆分）
│   ├── cache/                  # ← cache/
│   ├── redis/                  # ← redis/
│   ├── utils/                  # ← utils/（hash / logger / text-normalize）
│   └── shared/                 # ← models/document.ts + 跨 feature 共享类型集中地
│                                #   （Citation / ToolCallRecord / AgentStep / Result<T>）
│
├── infra/                      # ② 平台基础设施：外部适配器
│   ├── llm/                    # ← llm/
│   ├── embedding/              # ← embedding/
│   ├── storage/                # ← storage/
│   ├── hooks/                  # ← hooks/
│   ├── settings/               # ← settings/
│   └── auth/                   # ← auth/（JWT + RBAC + query-job-store）
│
├── features/                   # ③ 业务能力（垂直切片，一等公民）
│   ├── kb/                     # 知识库核心链路
│   │   ├── parser/             # ← parser/txt/md（不含 excel）
│   │   ├── splitter/           # ← splitter/
│   │   ├── retrieve/           # ← retrieve/
│   │   ├── pipeline/           # ← pipeline/（worker 入口仍可从此 re-export）
│   │   ├── tools/              # ← tools/（search_knowledge / get_* / list / summarize）
│   │   └── routes/             # ← routes/{ingest,documents,datasets}.ts
│   │
│   ├── chat/                   # 查询链路 + 通用 Skill
│   │   ├── agent/              # ← agent/（main / query / sub-agent-registry / system-prompt / registry）
│   │   ├── ws/                 # ← ws/
│   │   ├── skills/             # ← skills/ 的基础设施（loader/executor/registry/types/index）
│   │   │   └── builtin/        #   + 通用 Skill 种子：qa/search/compare/summary/multihop/chat/followups/mediation-advisor
│   │   └── routes/             # ← routes/{chat,sessions,query-jobs}.ts
│   │
│   ├── excel/                  # Excel 全栈（散落 → 内聚）
│   │   ├── parser/             # ← parser/excel-parser.ts
│   │   ├── tools/              # ← tools/excel/*（4 个）
│   │   ├── skills/             # ← skills/{excel-analysis,excel-profiling}/ 的 SKILL.md 种子
│   │   ├── analyze/            # ← analyze/duckdb-service.ts
│   │   └── routes/             # ← routes/excel.ts（687 LOC，迁移时按资源拆 sub-router）
│   │
│   ├── kg/                     # 知识图谱（原样整块迁入）
│   │   └── ...                 # ← kg/* 全部
│   │
│   └── admin/                  # 管理后台 CRUD（资源分散 → 集中）
│       ├── routes/             # ← routes/{agents,models,skills,skill-meta,settings,users,roles,stats,reload,index}.ts
│       └── (复用 infra/auth 与 core/db，不重复 service)
│
└── entry/                      # ④ 组装根
    ├── index.ts                # ← src/index.ts（HTTP bootstrap）
    ├── worker.ts               # ← pipeline/queue.ts（Worker 入口，改名清晰）
    ├── composition.ts          # 从 index.ts 抽出的 DI 组装（新增）
    └── routes.ts               # ← routes/index.ts 的 mountApiRoutes() 改写为按 feature 挂载
```

**入口脚本同步改动**：

| 文件 | 改动 |
|---|---|
| `app/package.json` | `"worker": "bun src/pipeline/queue.ts"` → `"bun src/entry/worker.ts"` |
| `app/package.json` | `"dev": "bun --watch src/index.ts"` → `"bun --watch src/entry/index.ts"`；`"start"` 同步 |
| `app/package.json` | `"chat": "bun tests/chat.ts"` 保持不变 |
| `app/drizzle.config.ts` | `schema: './src/db/schema/index.ts'` → `'./src/core/db/schema/index.ts'`；`out: './src/db/migrations'` → `'./src/core/db/migrations'` |

### 路径别名方案（迁移安全 + 长期收益）

为消除"相对路径深度计算"这一整类错误（128 文件迁移的高危点），在 `app/tsconfig.json` 添加：

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@core/*":     ["./src/core/*"],
      "@infra/*":    ["./src/infra/*"],
      "@features/*": ["./src/features/*"],
      "@entry/*":    ["./src/entry/*"]
    }
  }
}
```

**Bun 原生支持 tsconfig `paths`**（无需 tsconfig-paths），运行时 / 测试 / `bun run` 全部生效。

迁移完成后，所有跨模块 import 一律使用别名（如 `import { logger } from '@core/utils/logger'`），feature 内部相对引用可保留 `./`。**长期收益**：未来再迁移文件只影响其自身，不会连锁破坏引用方。

### Feature 对外接口约定

每个 `features/<name>/` 必须有 `index.ts` 作为公开 API：

```typescript
// features/excel/index.ts
export { excelRouter } from './routes';
export { DuckDBService } from './analyze/duckdb-service';
// 不导出内部文件，外部不得 deep-import
```

`entry/routes.ts` 只消费 feature 的公开 API：

```typescript
// entry/routes.ts
import { kbRoutes } from '@features/kb';
import { chatRoutes, chatWs } from '@features/chat';
import { excelRoutes } from '@features/excel';
import { kgRoutes } from '@features/kg';
import { adminRoutes } from '@features/admin';
// 挂载逻辑...
```

### 依赖方向（单向，编译期可校验）

```
entry ──→ features ──→ infra ──→ core
  │           │
  └───────────┴──→ infra / core（直连允许）
```

**禁止**：feature 之间互相 import；core/infra 反向引用上层。

---

## 影响范围

### 受影响的模块

| 模块 | 影响程度 | 说明 |
|---|---|---|
| `app/src/` 全部 128 文件 | 重大 | 物理位置全部变化，import 路径全部重写 |
| `app/tests/` 全部测试 | 中等 | import 路径重写；`*.test.ts` 重新归类（可选）|
| `app/tsconfig.json` | 重大 | 新增 baseUrl + paths |
| `app/package.json` | 中等 | dev/start/worker 脚本路径 |
| `app/drizzle.config.ts` | 中等 | schema/migrations 路径 |
| `docs/知识库设计.md` 第四章目录结构 | 中等 | 同步更新 |
| `PROJECT.md` 后端模块表 | 中等 | 同步更新路径 |
| `AGENTS.md` 文件结构段 | 中等 | 同步更新 |
| `README.md` 项目结构段 | 中等 | 同步更新 |

### 受影响的接口/协议

**零**。本次重组是纯结构性，不改任何对外 API、HTTP 路由、数据库 schema、WS 协议、Skill/Tool 注册接口。所有现有外部行为保持不变。

---

## 迁移计划（执行步骤）

> 所有步骤在单次提交内完成，但内部按依赖顺序执行以便定位问题。

### Step 1：加路径别名（不动文件）

- 改 `app/tsconfig.json`：加 `baseUrl` + `paths`
- 此时项目仍能编译，因为路径别名还没被使用

### Step 2：物理迁移（`git mv` 整块）

按依赖方向自底向上迁移（先 core，再 infra，最后 features 和 entry）：

1. `mkdir -p src/core src/infra src/features src/entry`
2. `git mv src/{config,db,cache,redis,utils} src/core/`
3. `git mv src/models/document.ts src/core/shared/`（新建 shared/）
4. `git mv src/{llm,embedding,storage,hooks,settings,auth} src/infra/`
5. KB：`git mv src/{parser,splitter,retrieve,pipeline} src/features/kb/` → 但 parser 要先剔出 excel
6. Excel：`git mv src/tools/excel src/features/excel/tools`；`git mv src/parser/excel-parser.ts src/features/excel/parser/`；`git mv src/analyze src/features/excel/`；`git mv src/skills/excel-{analysis,profiling} src/features/excel/skills/`
7. KB tools（剩余）：`git mv src/tools/* src/features/kb/tools/`（剩 search_knowledge / get_* / list / summarize）
8. Chat：`git mv src/{agent,ws} src/features/chat/`；`git mv src/skills src/features/chat/skills` → 然后 `git mv src/features/chat/skills/{qa,search,compare,summary,multihop,chat,followups,mediation-advisor} src/features/chat/skills/builtin/`
9. KG：`git mv src/kg src/features/`
10. Admin routes：把对应 route 文件分别 `git mv` 到 `src/features/admin/routes/`
11. KB/Chat/Excel/KG 各自的 routes 分别 `git mv` 到对应 feature 的 `routes/`
12. Entry：`git mv src/index.ts src/entry/index.ts`；`git mv src/pipeline/queue.ts src/entry/worker.ts`（pipeline 已先迁到 kb，从那里取）

> 实际执行时，每步 `git mv` 完用 `bun run typecheck` 校验当前断点（必然一堆 import 错，但能看到错误清单），下一步照单重写。

### Step 3：批量重写 import 路径

策略：**前缀替换**而非逐文件计算相对深度。

- `from '../config'` / `from '../../config'` / 任意深度 → `from '@core/config'`
- `from '../utils/logger'` 任意深度 → `from '@core/utils/logger'`
- 同理 `@core/db`、`@core/cache`、`@core/redis`、`@core/shared`
- `@infra/llm` `@infra/embedding` `@infra/storage` `@infra/hooks` `@infra/settings` `@infra/auth`
- `@features/kb/...` `@features/chat/...` `@features/excel/...` `@features/kg/...` `@features/admin/...`
- `@entry/...`（仅 entry 内部互引）

工具：用 `sed` / 脚本按"老路径片段 → 别名"做正则替换，然后 typecheck 收敛。**feature 内部相对引用（`./xxx`）保留不动**。

### Step 4：抽出 composition.ts（可选但推荐）

把 `entry/index.ts` 里的 DI 部分（embedding/retriever/llm/registries/agent 构造）抽到 `entry/composition.ts`，`index.ts` 只留 bootstrap + server 启动。降低单文件复杂度，方便测试。

### Step 5：worker 入口改名 + 脚本同步

- `pipeline/queue.ts`（现在 `features/kb/pipeline/queue.ts`）→ 复制到 `entry/worker.ts`，import 路径用别名
- 更新 `package.json` 的 `dev` / `start` / `worker` 脚本
- 更新 `drizzle.config.ts` 的 `schema` 与 `out`

### Step 6：tests/ 路径同步

- `app/tests/*.test.ts` 全部 import 重写为别名
- 草稿脚本（`smoke.ts` / `chat.ts` / `ws-query.ts` 等非测试）可选迁到 `tests/manual/`

### Step 7：文档同步

按"联系文档"表更新 5 处：`PROJECT.md`、`AGENTS.md`、`README.md`、`docs/知识库设计.md` 第四章。

### Step 8：changelog 同批完成

在 `openspec/changelog/20260717-global-module-restructure-three-layer.md` 记录本次变更动机、决策、验证结果。

---

## 风险评估

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| 128 文件 import 重写遗漏，typecheck 报错爆炸 | 高 | 低 | 别名前缀替换 + tsc 反复收敛，机械问题易定位 |
| Drizzle 迁移目录移动后 journal 失效 | 低 | 高 | `migrations/` 整块 `git mv`，内部相对引用不变；迁移前 `bun run db:migrate` 验证仍能识别已 applied |
| `bun test` 路径解析失败 | 中 | 中 | Bun 原生支持 tsconfig paths，迁移完先跑单个测试验证 |
| Worker / HTTP 双入口路径错 | 中 | 高 | 改完 `package.json` 后立即 `bun run dev` + `bun run worker` 冒烟 |
| 静态前端路径（`../status/dist`）相对位置变化 | 低 | 低 | `entry/index.ts` 用 `process.env.STATIC_ROOT ?? '../status/dist'`，从 `app/` 启动时 cwd 不变，相对路径仍正确 |
| Excel routes 拆分时遗漏 endpoint | 中 | 中 | `routes/excel.ts`（687 LOC）整文件搬到 `features/excel/routes/index.ts`，**不拆分**，保留 monolith 直到下一步独立 change |
| Skill 种子加载路径配置在多处（chat + excel）| 中 | 低 | SkillLoader 的种子扫描路径改为可配置数组，启动时扫描 `features/chat/skills/builtin/` + `features/excel/skills/` |

---

## 回滚方案

- 整次重组在**独立 feature branch** 上完成（建议 `refactor/three-layer-structure`）
- 每个执行 Step 一个 commit（共 8 个），任何一步失败可 `git reset --hard <step>` 回退
- 合并前完整跑 `bun run typecheck` + `bun test` + `BUN_TEST_INTEGRATION=true bun test`
- 若合并后发现运行时问题，`git revert` 合并 commit 即可全量回滚（结构纯位移，无逻辑改动，回滚干净）
- 数据库无任何 schema 变化，回滚不涉及数据

---

## 验证方式

- [ ] `bun run typecheck` 通过（零错误）
- [ ] `bun test`（单元测试）全部通过
- [ ] `BUN_TEST_INTEGRATION=true bun test`（集成测试）通过——需要 PG + Redis 启动
- [ ] `bun run dev` 启动，`curl http://localhost:3000/health` 返回 ok
- [ ] `bun run worker` 启动，日志显示 Worker ready
- [ ] 浏览器登录 admin，Chat 页发起一次问答，验证 WS 流式输出正常
- [ ] Excel 上传 + 问答一次，验证 DuckDB 链路正常
- [ ] KG 页（`/kg`）打开，验证 D3 渲染正常
- [ ] `bun run db:migrate` 仍能识别已 applied 的迁移（drizzle journal 完好）
- [ ] 跨模块 deep-import 检查：grep `from '\.\./features/[^']*/[a-z]` 应为零（feature 内部文件不应被 deep-import）

---

## 后续（不在本次范围）

本次只做"物理重组 + 别名"，下列留作后续独立 change：

1. Excel routes 687 LOC 按资源拆 sub-router
2. 共享类型集中到 `core/shared/types.ts`（Citation / ToolCallRecord / AgentStep 现散在各处）
3. `utils/` 收敛为 `core/utils/` + 按 feature 内聚的工具下沉
4. dependency-direction 编译期校验（ESLint rule 或自写脚本）
