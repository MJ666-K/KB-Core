# 功能设计：关系图谱（GraphRAG）

**日期**：2026-07-09
**项目缩写**：core（涉及 db / retrieve / pipeline / tools / skills / 前端）
**状态**：草案（待确认）

---

## 背景

KB-Core 当前的检索是**向量 + 全文**的孤立 chunk 匹配：`Dense(pgvector) + Sparse(tsvector) → RRF → Rerank → Parent 去重`。这对"找相关法条"有效，但对**关系推理类问题**力不从心：

- "劳动合同法第 X 条被哪些下位法引用了？" —— 需要法条之间的**引用关系**
- "这部法律的最新修正版是哪个？旧版还有效吗？" —— 需要**修正/废止关系链**
- "会计法关于会计核算的规定，和公司法财务报告要求是什么关系？" —— 需要**概念关联**
- "A 引用 B，B 又被 C 修正，最终适用哪条？" —— 需要**多跳关系推理**

传统 RAG 把文档切成孤立 chunk，丢失了法条之间的结构化关系。`docs/知识库设计.md` Phase 3 已将 **GraphRAG** 列为规划项。本设计即落地该规划：在入库时抽取实体与关系构成**法律关系图谱**，在检索时作为第三路召回与 Dense/Sparse 融合，并新增 Tool/Skill 让 Agent 能主动探索关系。

法律领域的图谱特征：节点规模中等（法条/法律/概念，几千–几万）、关系深度浅（引用链 2–3 跳）、查询模式固定（实体→邻居→扩展）。这决定了存储与查询方案的选型。

---

## 需求

- [ ] 入库时自动抽取**实体**（法律/法条/章节/概念/案件）与**关系**（引用/修正/废止/补充/解释/定义/属于/同义）
- [ ] 图谱与 chunk 双向关联：从节点能回溯原文 chunk，从 chunk 能查其贡献的节点
- [ ] 检索时图谱作为第三路召回，与 Dense/Sparse 三路 RRF 融合（对 Agent 透明，不破坏现有 HybridRetriever 契约）
- [ ] 新增 `search_graph` Tool，供 Agent/Skill 主动遍历关系子图
- [ ] 新增 `graph_qa` Skill，支持多跳关系推理问答
- [ ] 前端「关系图谱」页面：实体搜索 + 子图可视化（节点-边交互）
- [ ] Dashboard 增加图谱统计（节点数 / 关系数）
- [ ] 文档删除 / 重新嵌入时图谱自动同步（增量更新、无残留）
- [ ] 图谱遵循现有 datasetId / scope 权限隔离
- [ ] 存量已入库文档可批量回填图谱

---

## 技术方案

### 1. 架构影响

遵循现有 `Data → Tool → Skill → Agent` 分层，图谱作为 Data 层的新维度接入：

```
入库 pipeline（BullMQ）：
  parse → chunk(Parent-Child) → embed
        → ★ extract_graph（新阶段：LLM 抽实体+关系 → 写 nodes/edges）

检索 HybridRetriever：
  Dense + Sparse + ★ Graph（第三路）
        → RRF 三路融合 → Rerank → Parent 去重

Agent 层：
  QueryAgent 不变（function calling）
    ├─ Tool: + search_graph（新）
    └─ Skill: + graph_qa（新，多跳推理）

前端：
  + /graph 页面（子图可视化）
  + Dashboard 统计卡片
```

**关键约束**：图谱融合在 retriever 内部完成，对 QueryAgent / Skill / WS 协议**完全透明**——Agent 看到的仍是 `search_knowledge` 返回的 RetrievalResult，只是召回质量提升。只有需要显式关系探索时，Agent 才调 `search_graph`。

### 2. 数据模型

#### 2.1 graph_nodes（实体节点）

```sql
CREATE TYPE graph_node_type AS ENUM ('law', 'article', 'chapter', 'concept', 'case');

CREATE TABLE graph_nodes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id      UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  type            graph_node_type NOT NULL,
  name            TEXT NOT NULL,                 -- 原始名，如「劳动合同法第十条」
  normalized_name TEXT NOT NULL,                 -- 归一化：lowercase + 去标点《》空格
  description     TEXT,
  properties      JSONB NOT NULL DEFAULT '{}',   -- 如 {law_name, article_no, effective_date}
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX graph_nodes_dataset_idx   ON graph_nodes(dataset_id);
CREATE INDEX graph_nodes_doc_idx       ON graph_nodes(document_id);
CREATE INDEX graph_nodes_type_idx      ON graph_nodes(type);
-- 归一化名查询主索引（实体匹配用）
CREATE INDEX graph_nodes_norm_name_idx ON graph_nodes(dataset_id, normalized_name);
-- 同一 dataset + normalized_name + type 唯一，防止同实体重复插入
CREATE UNIQUE INDEX graph_nodes_uniq  ON graph_nodes(dataset_id, normalized_name, type);
```

#### 2.2 graph_edges（关系边）

```sql
CREATE TYPE graph_edge_type AS ENUM (
  'references', 'amends', 'repeals', 'supplements',
  'interprets', 'defines', 'belongs_to', 'synonym_of'
);

CREATE TABLE graph_edges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  src_id          UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  dst_id          UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  type            graph_edge_type NOT NULL,
  weight          REAL NOT NULL DEFAULT 1.0,     -- 关系强度（引用=1.0，同义=0.8）
  properties      JSONB NOT NULL DEFAULT '{}',   -- 如 {context, clause}
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX graph_edges_src_idx   ON graph_edges(src_id, type);
CREATE INDEX graph_edges_dst_idx   ON graph_edges(dst_id, type);  -- 反向遍历（"被引用"）
CREATE UNIQUE INDEX graph_edges_uniq ON graph_edges(src_id, dst_id, type);
```

#### 2.3 graph_node_chunks（节点-切片多对多关联）★

一个实体常跨多个 chunk 出现/被抽取，单 `sourceChunkId` 字段不够。用关联表表达多对多，检索时从节点 → 关联 chunks → 拿到 `chunks.id`，**与 Dense/Sparse 的 chunkId 空间完全一致**，可直接进 RRF。

```sql
CREATE TABLE graph_node_chunks (
  node_id    UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  chunk_id   UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  PRIMARY KEY (node_id, chunk_id)
);
CREATE INDEX graph_node_chunks_chunk_idx ON graph_node_chunks(chunk_id);
```

#### 2.4 graph_extraction_state（抽取幂等状态）

```sql
CREATE TABLE graph_extraction_state (
  chunk_id      UUID PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | done | failed
  node_count    INTEGER NOT NULL DEFAULT 0,
  edge_count    INTEGER NOT NULL DEFAULT 0,
  error_msg     TEXT,
  extracted_at  TIMESTAMPTZ,
  content_hash  TEXT NOT NULL                       -- chunk 内容哈希，变更才重抽
);
```

#### 2.5 ingest_jobs 扩展

`ingest_stage_enum` 增加 `'extract_graph'`：

```sql
ALTER TYPE ingest_stage_enum ADD VALUE 'extract_graph';
```

#### 2.6 Drizzle Schema（新增 `app/src/db/schema/graph.ts`）

```typescript
export const graphNodeTypeEnum = pgEnum('graph_node_type', ['law','article','chapter','concept','case']);
export const graphEdgeTypeEnum = pgEnum('graph_edge_type', ['references','amends','repeals','supplements','interprets','defines','belongs_to','synonym_of']);

export const graphNodes = pgTable('graph_nodes', { /* 上述字段 */ }, (t) => [
  index('graph_nodes_dataset_idx').on(t.datasetId),
  index('graph_nodes_doc_idx').on(t.documentId),
  index('graph_nodes_type_idx').on(t.type),
  index('graph_nodes_norm_name_idx').on(t.datasetId, t.normalizedName),
  uniqueIndex('graph_nodes_uniq').on(t.datasetId, t.normalizedName, t.type),
]);

export const graphEdges = pgTable('graph_edges', { /* ... */ }, (t) => [
  index('graph_edges_src_idx').on(t.srcId, t.type),
  index('graph_edges_dst_idx').on(t.dstId, t.type),
  uniqueIndex('graph_edges_uniq').on(t.srcId, t.dstId, t.type),
]);

export const graphNodeChunks = pgTable('graph_node_chunks', { /* ... */ });
export const graphExtractionState = pgTable('graph_extraction_state', { /* ... */ });
```

在 `schema/index.ts` 统一导出。

### 3. 关系抽取（pipeline 新阶段）

新增 `app/src/pipeline/extract-graph.ts`，作为 BullMQ worker 的 embed 之后阶段。

#### 3.1 抽取策略

- **仅对 parent chunk 抽取**：parent（1200t）上下文完整、信息密度高；child（300t）过碎易误抽。parent → 子图节点，减少 LLM 调用 N 倍。
- **LLM structured output**：用 LLMService 的 function calling，定义 `extract_legal_entities` 函数，返回 `{entities:[{name,type,description}], relations:[{src,dst,type,context}]}`。
- **批量化**：单次 LLM 调用处理一个 parent chunk（如需可扩展为多 chunk 合并，但首版单 chunk 更稳）。

#### 3.2 幂等

- 入库时为每个 parent chunk 在 `graph_extraction_state` 建记录，存 `content_hash`。
- Worker 执行前比对 `content_hash`：相同则跳过（已抽取）；不同则先删旧数据（按 chunk_id 清 `graph_node_chunks` + 关联孤立节点）再重抽。
- 失败记录 `error_msg`，可重试（BullMQ retry）。

#### 3.3 实体归一化与去重

- `normalized_name = name.toLowerCase().replace(/[《》\s""''·]/g, '')`
- **只做字符级归一化，不做语义合并**：避免"合同法"与"劳动合同法"误合并（它们是不同法律）。
- 同实体跨 chunk：靠 `graph_nodes_uniq(dataset_id, normalized_name, type)` 唯一约束 + `ON CONFLICT DO NOTHING`，第二次 INSERT 同名实体跳过，再通过 `graph_node_chunks` 关联到新 chunk。
- 同义关系用 `synonym_of` 边表达，**不合并节点**——保留可追溯性。

#### 3.4 抽取 Prompt（种子）

```
你是法律文本结构化抽取器。从给定法条文本抽取实体与关系。

实体类型：law(法律) / article(法条) / chapter(章节) / concept(法律概念) / case(案件)
关系类型：references(引用) / amends(修正) / repeals(废止) / supplements(补充)
         /interprets(解释) / defines(定义) / belongs_to(属于) / synonym_of(同义)

规则：
- 实体 name 用全称（如「劳动合同法第十条」，不写「第十条」）
- 关系 src/dst 必须是已抽取的实体 name
- 只抽取文本明确表达的关系，不臆测
- 输出 JSON：{entities:[{name,type,description}], relations:[{src,dst,type,context}]}
```

### 4. 检索融合（三路 RRF）

#### 4.1 graphSearch（新增 `app/src/retrieve/graph.ts`）

查询时第三路召回：

```
1. 实体匹配：query → 在 graph_nodes.normalized_name 上 ILIKE 匹配（不调 LLM，快）
   - 命中节点 = seed nodes（score 1.0）
   - 无命中 → fallback：可选 LLM 抽 query 实体再匹配（首版可跳过，graph 路返回空）
2. 邻居扩展：从 seed nodes 出发，WITH RECURSIVE 遍历 1-2 跳
   - score 按 1/depth 衰减，乘关系 weight
3. 收集关联 chunks：遍历结果节点的 graph_node_chunks.chunk_id
   - 每个 chunk 的 graph_score = max(节点 score)（取最强路径）
4. 返回 graphHits: [{chunkId, score}] ranked list
```

#### 4.2 RRF 三路融合

改造 `retriever.ts`：

```typescript
const [denseHits, sparseHits, graphHits] = await Promise.all([
  denseSearch(...), sparseSearch(...), graphSearch(query, opts),
]);
const fused = rrfFusion3Way(denseHits, sparseHits, graphHits, q.rrfK);
```

`rrfFusion3Way` 复用现有 RRF 公式 `1/(k+rank)`，三路各自按 score 排名后融合。**graph 路无需 score 归一化**——RRF 只用 rank，天然解决三路尺度不一问题。

#### 4.3 配置开关

`QuerySettings` 增加 `graphEnabled: boolean`（默认 true）+ `graphSearchDepth: 1|2`。可在 Settings 页开关，便于 A/B 对比与降级。

### 5. Tool 扩展：search_graph

新增 `app/src/tools/search-graph.ts`：

| 字段 | 值 |
|---|---|
| name | `search_graph` |
| description | 搜索法律关系图谱，返回实体节点、关系与关联切片。用于回答"引用/修正/废止"等关系类问题 |
| parameters | `{ query: string, relationTypes?: graph_edge_type[], depth?: 1|2 }` |
| 返回 | `{ nodes: [{id,name,type,description}], edges: [{src,dst,type}], chunks: [{chunkId,documentId,snippet}] }` |
| 可见范围 | 全部 Agent |

注册到 ToolRegistry，加入 Skill 的 tools 白名单可选。

### 6. Skill 扩展：graph_qa

新增 `app/src/skills/graph-qa/SKILL.md`（作种子，DB 空时导入）：

```markdown
---
name: graph_qa
description: "多跳关系推理问答。基于关系图谱探索法条引用/修正链，回答需要跨法条推理的问题。"
tools:
  - search_graph
  - search_knowledge
parameters:
  type: object
  properties:
    query: { type: string, description: "涉及法条关系的问题" }
  required: [query]
---

# Graph QA Skill

你的任务是回答涉及法律条文**关系**的问题（引用、修正、废止、补充）。

## 执行步骤
1. 调用 search_graph({ query, depth: 2 }) 获取关系子图
2. 分析子图中的关系链（A references B, B amends C...）
3. 如需原文佐证，调用 search_knowledge({ query }) 取相关法条文本
4. 基于关系链 + 原文，给出带引用标注的推理答案
5. 在答案中用"A →引用→ B →修正→ C"形式可视化关系链
```

### 7. 接口设计

#### 7.1 REST API（新增）

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | `/api/graph/search` | 实体搜索 + 子图（query, datasetId, depth?）| documents:read |
| GET | `/api/graph/nodes/:id` | 节点详情 + 直接邻居 | documents:read |
| GET | `/api/graph/subgraph` | 多跳子图（nodeId, depth, limit）| documents:read |
| POST | `/api/graph/rebuild` | 对指定 dataset/document 批量重抽图谱 | documents:write |
| GET | `/api/stats` | 扩展返回 graphNodes / graphEdges 计数 | dashboard:view |

#### 7.2 WebSocket

**无变化**。图谱融合在 retriever 内部，WS 事件流（thinking/step/token/result）保持原样。Agent 调 `search_graph` Tool 时，step 事件照常展示。

### 8. 前端

#### 8.1 新增 /graph 页面（`status/src/pages/Graph.tsx`）

- 顶部：实体搜索框（调 `/api/graph/search`）+ 数据集切换
- 主区：子图可视化，用 **react-flow**（轻量、虚拟化、Antd 风格兼容）
  - 节点按 type 配色（law=蓝/article=绿/concept=橙...）
  - 边按 type 标签（引用/修正...）+ 方向箭头
  - 节点点击 → 右侧抽屉展示详情 + 邻居 + 关联文档原文链接
- 限制：子图最多 50 节点（性能 + 可读），超出提示收窄 depth

#### 8.2 菜单与权限

`App.tsx` 的 `ALL_MENU_ITEMS` 增加：

```typescript
{ key: '/graph', icon: <NodeIndexOutlined />, label: '关系图谱',
  title: '关系图谱', subtitle: '法条引用 · 修正 · 废止关系',
  permissions: ['documents:read'] }  // 复用文档读权限，不新增 RBAC 项
```

插在「文档库」与「法律助手」之间。

#### 8.3 Dashboard

统计卡片从 8 增至 10：加「图谱节点」「图谱关系」。

### 9. 关键决策

| # | 决策 | 选择 | 理由 / 备选 |
|---|---|---|---|
| 1 | 图谱存储 | **nodes/edges 邻接表 + PG 递归 CTE** | 无新基础设施；法律图谱深度浅(2-3跳)、规模中(几千-几万节点)，递归 CTE + 索引足够；与 pgvector 同库便于联表；Drizzle 原生支持。**备选** Apache AGE(Cypher) 需装 PG 扩展且 Drizzle 不原生支持；Neo4j 引入新组件过重。 |
| 2 | 抽取粒度 | **仅 parent chunk 抽取** | parent(1200t) 上下文完整、误抽少；LLM 调用量降为数十分之一；child 不单独抽但通过 graph_node_chunks 仍可关联。**备选** 每 child 抽取成本高 N 倍且碎片化。 |
| 3 | 实体去重 | **字符级归一化 + 唯一约束，不做语义合并** | 防止"合同法"与"劳动合同法"误合并；同义用 synonym_of 边表达，保留可追溯。跨 chunk 同实体靠 ON CONFLICT DO NOTHING 跳过 + 关联表追加。 |
| 4 | 检索融合 | **三路 RRF（dense+sparse+graph）** | RRF 只用 rank 不需 score 归一化，天然解决三路尺度不一；graph 路可独立开关(graphEnabled)便于降级/对比。**备选** 加权融合需调参、尺度难统一。 |
| 5 | 图谱-chunk 关联 | **graph_node_chunks 多对多关联表** | 单 sourceChunkId 字段无法表达实体跨多 chunk；多对多表让 graph 召回的 chunkId 与 dense/sparse 同空间(chunks.id)，直接进 RRF。 |
| 6 | 增量同步 | **document/chunk 外键 CASCADE + 重新嵌入时按 document_id 清旧** | 文档删除时 graph_nodes(document_id) CASCADE 自动清；重新嵌入先 DELETE WHERE document_id 再重抽，无残留。graph_extraction_state.content_hash 守幂等。 |
| 7 | 查询实体匹配 | **ILIKE 匹配 normalized_name 优先，无命中再 LLM 抽取** | 大部分查询含实体名关键词，ILIKE 零 LLM 调用、毫秒级；仅无匹配时 fallback LLM，避免每次查询增延迟。 |
| 8 | 防环 | **递归 CTE 用 UNION(去重) + depth 上限** | 法律引用通常无环，但概念同义可能双向；UNION 自动去重防无限循环，depth≤2 兜底。 |
| 9 | 权限隔离 | **复用 documents:read，不新增 RBAC 权限项** | 图谱源于文档，能读文档即可读图谱；避免改 10 项权限枚举与所有角色。图谱节点带 dataset_id/scope，检索按 datasetIds 过滤，与现有隔离一致。 |
| 10 | 可视化库 | **react-flow** | 轻量、虚拟化、React 生态、可定制节点；子图限 50 节点保性能。**备选** antv G6 功能强但体积大、Antd 风格融合稍差。 |

### 10. 风险与对策

| 风险 | 对策 |
|---|---|
| LLM 抽取漏抽/误抽关系 | 抽取 prompt 约束"只抽明确表达的关系"；失败可重试；graph_extraction_state 记录 node/edge_count 便于审计 |
| 存量文档无图谱 | 提供 `/api/graph/rebuild` 批量回填接口；首版可手动触发 |
| graph 召回拖慢查询 | ILIKE 走索引毫秒级；graph 路与 dense/sparse 并行(Promise.all)；可 graphEnabled 关闭降级 |
| 子图过大前端卡顿 | API 层 limit 节点数；前端 react-flow 虚拟化 + 50 节点上限 |
| 实体归一化边界 | 只做字符级，保守；同义用边而非合并，可人工 review 后增 synonym_of 边 |

---

## 影响范围

| 文件/模块 | 变更类型 | 说明 |
|---|---|---|
| `app/src/db/schema/graph.ts` | 新增 | graph_nodes/edges/node_chunks/extraction_state 定义 |
| `app/src/db/schema/index.ts` | 修改 | 导出 graph schema |
| `app/src/db/schema/ingest-job.ts` | 修改 | stage enum 增 `extract_graph` |
| `app/migrations/*.sql` | 新增 | 建表 + enum 扩展迁移 |
| `app/src/pipeline/extract-graph.ts` | 新增 | LLM 抽取 worker 阶段 |
| `app/src/pipeline/ingest-pipeline.ts` | 修改 | pipeline 串联 extract_graph 阶段 |
| `app/src/retrieve/graph.ts` | 新增 | graphSearch + 递归 CTE 子图遍历 |
| `app/src/retrieve/retriever.ts` | 修改 | 三路 RRF 融合 + graphEnabled 开关 |
| `app/src/retrieve/rrf.ts` | 修改 | 增 rrfFusion3Way |
| `app/src/tools/search-graph.ts` | 新增 | search_graph Tool |
| `app/src/tools/index.ts` | 修改 | 注册 search_graph |
| `app/src/skills/graph-qa/SKILL.md` | 新增 | graph_qa Skill 种子 |
| `app/src/settings/types.ts` | 修改 | QuerySettings 增 graphEnabled/graphSearchDepth |
| `app/src/routes/graph.ts` | 新增 | /api/graph/* 路由 |
| `app/src/routes/stats.ts` | 修改 | 返回图谱统计 |
| `app/src/routes/index.ts` | 修改 | 挂载 /api/graph |
| `status/src/pages/Graph.tsx` | 新增 | 关系图谱可视化页 |
| `status/src/App.tsx` | 修改 | 菜单增 /graph 项 |
| `status/src/api.ts` | 修改 | 增 graph API 调用 |
| `status/src/pages/Dashboard.tsx` | 修改 | 增图谱统计卡片 |
| `status/package.json` | 修改 | 加 react-flow 依赖 |
| `docs/知识库设计.md` | 修改 | Phase 3 GraphRAG 标记进行中 + 补图谱 schema |
| `docs/开发文档.md` | 修改 | 增 GraphRAG 相关 Step |

---

## 测试计划

- [ ] `bun run typecheck` 0 errors（strict）
- [ ] graph schema 迁移成功 + Drizzle Studio 可见
- [ ] 单测：`extract-graph.ts` 对示例法条抽取实体/关系正确，幂等（同 content_hash 不重抽）
- [ ] 单测：`graph.ts` 递归 CTE 子图遍历 2 跳无环、depth 限制生效
- [ ] 单测：`rrfFusion3Way` 三路融合排名正确
- [ ] 集成：文档入库 → 自动抽取 → graph_nodes/edges 有数据 → graph_node_chunks 关联正确
- [ ] 集成：`HybridRetriever.retrieve` 返回结果含 graph 召回贡献（graphEnabled 开关对比）
- [ ] 集成：文档删除 → 图谱 CASCADE 清理无残留
- [ ] 集成：重新嵌入 → 旧图谱清理后重抽
- [ ] `search_graph` Tool 被 Agent 调用，返回结构正确
- [ ] `graph_qa` Skill 多跳推理回答含关系链
- [ ] 前端 /graph 页面搜索 + 子图渲染 + 节点点击抽屉
- [ ] Dashboard 显示节点/关系计数
- [ ] 权限：无 documents:read 的账号看不到 /graph 菜单与 API 403

---

## 时间估算

分 6 阶段渐进，每阶段独立可测：

| 阶段 | 内容 | 预估 |
|---|---|---|
| 1 | Schema + Migration + Drizzle | 1 agent 周期 |
| 2 | extract-graph 抽取阶段 + 幂等 + 归一化 | 2 agent 周期 |
| 3 | graphSearch + 三路 RRF + 配置开关 | 2 agent 周期 |
| 4 | search_graph Tool + graph_qa Skill | 1 agent 周期 |
| 5 | 前端 /graph 页面 + Dashboard 统计 | 2 agent 周期 |
| 6 | 存量数据回填 + 集成测试 + changelog + 文档更新 | 1 agent 周期 |

总计约 **9 个并行 agent 周期**。阶段 1-2 可与 4 并行起步（4 不依赖图谱数据，仅定义接口），阶段 3 依赖 1-2，阶段 5 依赖 3 的 API。

---

## 实施顺序建议

1. **先确认本设计**（用户 review 关键决策表，尤其存储方案与抽取粒度）
2. 阶段 1 → 2 → 3（数据 + 抽取 + 检索融合，后端闭环）
3. 阶段 4（Tool/Skill，可与服务端并行）
4. 阶段 5（前端，依赖 API）
5. 阶段 6（回填存量 + 全链路测试）
6. 每阶段完成即写 changelog，更新 `docs/知识库设计.md` 对应章节

> 注：Oracle 架构审查因模型路由故障未能完成，关键决策已由设计者自我批判式论证（见第 9 节备选方案与第 10 节风险对策）。实现前可再行外部 review 或先做阶段 1-2 的 spike 验证抽取质量与递归 CTE 性能。
