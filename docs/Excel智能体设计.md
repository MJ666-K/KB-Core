# Excel 智能体设计文档

> 基于 Agent 架构的 Excel 智能分析系统。支持任意格式、任意大小的 Excel 文件，自动生成透视表和分析报告。

---

## 一、核心问题

| 问题 | 挑战 | 解决方案 |
|---|---|---|
| **格式不确定** | 不同 Excel 结构完全不同（销售表、考勤表、财务报表...），无法预设固定分析流程 | Agent 先 profiling 理解数据，再自主决定分析策略 |
| **数据量大** | 文件可能几十万行，不能全量加载到内存，聚合不能遗漏 | 流式解析 + DuckDB 分析引擎，SQL 聚合覆盖所有数据 |
| **多 Sheet / 多文件** | 一个文件多个 Sheet 格式可能不同；多个文件可能格式相同也可能不同 | 每个 Sheet 独立 profiling；格式相同自动合并（UNION ALL），格式不同独立分析或跨表 JOIN |
| **分析深度** | 不能只给 LLM 粗糙的统计摘要，需要完整的数据视图才能生成准确的洞察 | LLM 生成任意 SQL 多轮探索（分布、峰值、异常、趋势、相关性），基于完整视图生成报告 |

---

## 二、整体架构

### 2.1 架构图

```
┌───────────────────────────────────────────────────────────┐
│              ExcelAgent（Excel 专用子 Agent）               │
│  System Prompt: 三阶段工作流                               │
│  可用 Skill: excel_profiling, excel_analysis              │
│  可用 Tool: profile_excel, execute_query, create_pivot,   │
│            generate_report                                │
└─────────────────────────┬─────────────────────────────────┘
                          │
             ┌────────────┴────────────┐
             │                         │
       ┌─────▼──────┐          ┌──────▼───────────────┐
       │  Skill 层   │          │  Tool 层              │
       │             │          │                      │
       │ excel_      │          │ profile_excel        │
       │ profiling   │          │ （流式解析 + 画像）   │
       │             │          │                      │
       │ excel_      │          │ execute_query        │
       │ analysis    │          │ （LLM 生成任意 SQL）  │
       │             │          │                      │
       │             │          │ create_pivot         │
       │             │          │ （透视表快捷方式）    │
       │             │          │                      │
       │             │          │ generate_report      │
       │             │          │ （报告生成）          │
       └─────────────┘          └──────────┬───────────┘
                                           │
                                    ┌──────▼──────┐
                                    │  DuckDB     │
                                    │  分析引擎    │
                                    └─────────────┘
```

### 2.2 三阶段工作流（核心）

```
阶段 1：数据画像（自动化）
  │
  │  profile_excel → DataProfile
  │  （表头 + 样本 + 分位数 + 频次分布 + 相关性矩阵）
  │
  ▼
阶段 2：深度探索（LLM 驱动，多轮）
  │
  │  LLM 看 DataProfile → 推断业务含义 → 生成 SQL
  │  execute_query → 获取结果 → LLM 判断是否需要更多数据
  │  （分布、峰值、异常、趋势、相关性... 逐步深入）
  │
  ▼
阶段 3：透视表 + 报告（基于完整数据视图）
  │
  │  LLM 基于多轮探索获取的完整数据视图
  │  → 自主决定生成几个透视表、用什么维度
  │  → 生成分析报告（洞察基于实际探索数据，不是凭空生成）
  │
  ▼
输出：透视表（全量）+ 分析报告 + 下载链接
```

**关键**：LLM 不是一次性获取所有数据，而是**多轮探索、逐步深入**，直到获取到足够的信息。所有数据获取通过 SQL（DuckDB 执行），保证覆盖全部数据、不遗漏。

### 2.3 多 Sheet / 多文件处理

```
用户上传文件（可能多个）
  ↓
ExcelParser 流式解析
  ↓
┌─ 单文件多 Sheet ─────────────────────────────┐
│  Sheet1 → DuckDB 表 excel_{docId}_0          │
│  Sheet2 → DuckDB 表 excel_{docId}_1          │
│  每个 Sheet 独立 profiling                    │
└──────────────────────────────────────────────┘
  ↓
┌─ 多文件处理 ─────────────────────────────────┐
│  格式相同 → UNION ALL 合并为一张表            │
│  格式不同 → 各自独立 profiling                │
└──────────────────────────────────────────────┘
  ↓
DataProfile 存入 PostgreSQL → LLM 理解数据
```

| 场景 | 处理方式 |
|---|---|
| 12 个月度报表（格式相同） | 自动合并 → 统一分析 → 年度汇总透视表 |
| 销售表 + 库存表（格式不同） | 独立 profiling → 分别分析 → 可选跨表 JOIN |
| 单文件多 Sheet（格式不同） | 每个 Sheet 独立 → Agent 决定是否跨 Sheet 关联 |

### 2.4 组件清单

| 组件 | 文件位置 | 职责 |
|---|---|---|
| ExcelAgent | `app/src/agent/excel-agent.ts` | Excel 专用子 Agent |
| ExcelParser | `app/src/parser/excel-parser.ts` | Excel 流式解析（SAX 模式） |
| DuckDBService | `app/src/analyze/duckdb-service.ts` | DuckDB 连接管理 + SQL 执行 |
| Excel Tools | `app/src/tools/excel/` | 4 个原子 Tool |
| Excel Skills | `app/src/skills/excel/` | 2 个 Skill |

---

## 三、数据模型

### 3.1 存储分层

| 数据 | 存储位置 | 原因 |
|---|---|---|
| 原始 Excel 数据 | DuckDB 临时表 | 大数据量，流式写入，SQL 聚合 |
| DataProfile | PostgreSQL `excel_profiles` | 小数据（元数据），供 LLM 理解 |
| 透视表结果 | PostgreSQL `pivot_tables` | 聚合后数据量小，**全量存储** |
| 分析报告 | PostgreSQL `excel_reports` | 小数据，持久化 |

### 3.2 DuckDB 临时表

每个 Sheet 对应一张 DuckDB 表，表名 = `excel_{documentId}_{sheetIndex}`。

```sql
-- 动态创建（列根据 Excel 表头推断）
CREATE TABLE excel_abc123_0 (
  日期 DATE,
  产品 VARCHAR,
  金额 DOUBLE,
  区域 VARCHAR
);

-- 流式写入（每次 1000 行）
INSERT INTO excel_abc123_0 VALUES (...), (...), ...;
```

- 文件存储：`data/duckdb/temp_{documentId}.duckdb`
- 保留策略：7 天后自动清理

### 3.3 PostgreSQL：excel_profiles

```typescript
export const excelProfiles = pgTable('excel_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentIds: uuid('document_ids').array().notNull(),    // 支持多文件
  datasetId: uuid('dataset_id').references(() => datasets.id).notNull(),

  fileCount: integer('file_count').notNull(),
  fileNames: text('file_names').array().notNull(),
  sheets: jsonb('sheets').$type<SheetProfile[]>().notNull(),

  merged: boolean('merged').notNull().default(false),      // 多文件格式相同时为 true
  mergedDuckdbTable: text('merged_duckdb_table'),          // 合并后的表名

  businessContext: text('business_context'),                // LLM 推断的业务含义
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
});

interface SheetProfile {
  documentId: string;
  fileName: string;
  sheetName: string;
  sheetIndex: number;
  rowCount: number;
  columns: ColumnProfile[];
  sampleData: Record<string, unknown>[];   // 前 10 行
  duckdbTable: string;                     // excel_{documentId}_{sheetIndex}
}

interface ColumnProfile {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  nullable: boolean;
  nullCount: number;
  uniqueCount: number;
  numericStats?: {
    min: number; max: number; avg: number; median: number; std: number;
    percentiles: { P25: number; P50: number; P75: number; P90: number; P95: number; P99: number };
  };
  topValues?: { value: string; count: number }[];           // 数值列 Top 10
  frequencyDistribution?: Record<string, number>;           // 分类列完整频次
  dateRange?: { min: string; max: string };                 // 日期列范围
  granularity?: 'day' | 'week' | 'month' | 'year';         // 日期列粒度
  sampleValues?: unknown[];
}
```

### 3.4 PostgreSQL：pivot_tables

```typescript
export const pivotTables = pgTable('pivot_tables', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').references(() => excelProfiles.id, { onDelete: 'cascade' }).notNull(),

  name: text('name').notNull(),
  description: text('description'),
  config: jsonb('config').$type<PivotConfig>().notNull(),

  // 全量存储（聚合结果通常只有几十到几百行）
  rows: jsonb('rows').$type<Record<string, unknown>[]>().notNull(),
  rowCount: integer('row_count').notNull(),

  // 可视化数据（D3/ECharts 可直接消费）
  visualization: jsonb('visualization').$type<VisualizationData>(),

  sql: text('sql').notNull(),                                // 生成 SQL（可复现）
  sourceSheets: text('source_sheets').array().notNull(),     // 数据来源

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 透视表配置：支持 2D / 3D / 交叉表
interface PivotConfig {
  // 基础维度
  rowFields: string[];               // 行维度
  columnFields?: string[];           // 列维度（交叉表）
  pageFields?: string[];             // 页维度（3D 透视表：每个 page 值一个独立表）
  valueField: string;                // 值字段
  aggregation: 'sum' | 'avg' | 'count' | 'min' | 'max';
  filters?: Record<string, unknown>;
  sortBy?: { field: string; order: 'asc' | 'desc' };

  // 多文件/多 Sheet
  sourceDocuments?: string[];
  sourceSheets?: string[];

  // 可视化类型（Agent 根据数据特征选择）
  chartType?: 'bar' | 'line' | 'pie' | 'heatmap' | 'treemap' | 'sunburst' | 'sankey' | 'radar' | 'scatter' | 'waterfall' | 'funnel' | 'gauge';
}

// 可视化数据（前端 D3/ECharts 直接消费）
interface VisualizationData {
  chartType: string;
  // 标准图表数据（bar/line/pie/radar/gauge/funnel/waterfall）
  series?: { name: string; data: number[] }[];
  categories?: string[];
  // 热力图数据（heatmap）
  heatmapData?: { x: string; y: string; value: number }[];
  // Treemap / Sunburst（层级数据）
  hierarchyData?: { name: string; value?: number; children?: unknown[] }[];
  // Sankey（流向数据）
  sankeyData?: { nodes: { name: string }[]; links: { source: string; target: string; value: number }[] };
  // Scatter（散点数据）
  scatterData?: { x: number; y: number; size?: number; label?: string }[];
  // 3D 透视表（pageFields 不为空时）
  pages?: { pageValue: string; rows: Record<string, unknown>[] }[];
  // 元信息
  title?: string;
  xAxisName?: string;
  yAxisName?: string;
}
```

**透视表类型说明**：

| 类型 | 配置 | 可视化 | 场景 |
|---|---|---|---|
| **2D 简单表** | rowFields + valueField | bar / pie | 按区域汇总销售 |
| **2D 交叉表** | rowFields + columnFields + valueField | heatmap | 区域×产品矩阵 |
| **3D 透视表** | rowFields + pageFields + valueField | 多张表（每 page 一张） | 按月查看各区域销售 |
| **层级表** | rowFields（多级）+ valueField | treemap / sunburst | 区域→产品→子品类层级 |
| **流向表** | source + target + value | sankey | 资金流向、转化漏斗 |

### 3.5 PostgreSQL：excel_reports

```typescript
export const excelReports = pgTable('excel_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').references(() => excelProfiles.id, { onDelete: 'cascade' }).notNull(),

  title: text('title').notNull(),
  format: text('format').notNull(),    // markdown | json | excel
  content: text('content').notNull(),

  pivotTableIds: uuid('pivot_table_ids').array().notNull().default([]),
  insights: jsonb('insights').$type<string[]>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

---

## 四、Tool 设计

### 4.1 profile_excel（数据画像）

流式解析 Excel，提取丰富的数据画像，写入 DuckDB。

```typescript
interface ProfileExcelParams {
  documentIds: string[];       // 支持多文件
  mergeIfSame?: boolean;       // 格式相同时是否合并（默认 true）
  sheetIndices?: number[];     // 指定 Sheet（默认所有）
}

interface ProfileExcelResult {
  profileId: string;
  fileCount: number;
  fileNames: string[];
  sheetCount: number;
  totalRows: number;
  sheets: SheetProfile[];
  merged: boolean;
  mergedDuckdbTable?: string;
}
```

**实现要点**：
- 流式解析（xlsx SAX 模式）：分块读取，内存恒定 ~50MB
- 自动类型推断：扫描前 1000 行推断列类型
- 丰富统计特征：
  - 数值列：min/max/avg/median/std、分位数（P25~P99）、Top 10 峰值
  - 分类列：完整频次分布（所有唯一值的频次）
  - 日期列：时间范围、粒度推断（天/周/月/年）
  - 数值列间相关性矩阵（Pearson）
- 多文件格式相同时 UNION ALL 合并

**数据画像示例**（LLM 看到的内容）：

```json
{
  "sheetName": "销售数据",
  "rowCount": 1234567,
  "columns": [
    {
      "name": "金额", "type": "number",
      "nullCount": 12, "uniqueCount": 8901,
      "numericStats": {
        "min": 0.5, "max": 99999.9, "avg": 1234.5, "median": 890.0, "std": 2345.6,
        "percentiles": { "P25": 200, "P50": 890, "P75": 1800, "P90": 3500, "P95": 5000, "P99": 15000 }
      },
      "topValues": [99999.9, 88888.8, 77777.7]
    },
    {
      "name": "区域", "type": "string",
      "uniqueCount": 30,
      "frequencyDistribution": { "华东": 450000, "华南": 320000, "华北": 280000 }
    }
  ],
  "correlationMatrix": { "金额": { "数量": 0.85 } }
}
```

LLM 从中推断：
- "金额右偏分布（P99 >> P50），可能有异常大值"
- "金额和数量高度相关（0.85）"
- "区域分布不均匀，华东占 36%"

### 4.2 execute_query（LLM 生成任意 SQL）

LLM 生成任意 SQL 在 DuckDB 上执行。**这是深度探索数据的核心 Tool。**

```typescript
interface ExecuteQueryParams {
  profileId: string;
  sql: string;              // LLM 生成的任意 SELECT
  description?: string;     // LLM 说明查询目的
}

interface ExecuteQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  sql: string;
  executionTimeMs: number;
  truncated: boolean;       // 是否超过 limit（默认 10000 行）
}
```

**实现要点**：
- 支持任意 SELECT（GROUP BY / JOIN / 窗口函数 / 子查询 / CASE WHEN）
- 安全限制：只允许 SELECT（禁止 INSERT/UPDATE/DELETE/DROP）
- 多轮探索：LLM 可多次调用，逐步深入
- 结果限制：默认最多返回 10000 行

**多轮探索示例**：

```
LLM 看 DataProfile → "金额 P99=15000，需要看异常值"

第 1 轮：
  SQL: SELECT 金额, COUNT(*) as cnt FROM excel_abc_0
       WHERE 金额 > 15000 GROUP BY 金额 ORDER BY 金额 DESC LIMIT 20
  结果：20 行异常大值
  LLM："有 156 条异常，需要看特征"

第 2 轮：
  SQL: SELECT 区域, 产品, COUNT(*) as cnt, AVG(金额)
       FROM excel_abc_0 WHERE 金额 > 15000
       GROUP BY 区域, 产品 ORDER BY cnt DESC
  结果：集中在"华东"+"高端产品"
  LLM："异常值是高端产品大额订单，不是数据错误"

第 3 轮：
  SQL: SELECT DATE_TRUNC('month', 日期) as 月份,
       COUNT(*) as 订单数, SUM(金额) as 月销售额
       FROM excel_abc_0 GROUP BY 月份 ORDER BY 月份
  结果：12 个月趋势
  LLM："数据足够，进入阶段 3"
```

### 4.3 create_pivot（透视表生成）

`execute_query` 的快捷方式，适合简单 GROUP BY 聚合。全量结果存入 PostgreSQL。

```typescript
interface CreatePivotParams {
  profileId: string;
  config: PivotConfig;
  name: string;
  description?: string;
}

interface CreatePivotResult {
  pivotTableId: string;
  rowCount: number;
  rows: Record<string, unknown>[];   // 全量，不截断
  sql: string;
  sourceSheets: string[];
}
```

**与 execute_query 的关系**：
- `create_pivot`：快捷方式，适合简单 GROUP BY
- `execute_query`：更灵活，适合窗口函数、复杂 JOIN、子查询
- 典型流程：先用 `execute_query` 探索，再用 `create_pivot` 生成最终透视表

### 4.4 generate_report（报告生成）

基于 DataProfile + 探索结果 + 透视表，生成分析报告。

```typescript
interface GenerateReportParams {
  profileId: string;
  pivotTableIds?: string[];
  explorationSummary?: string;    // LLM 总结的探索发现
  format: 'markdown' | 'json' | 'excel';
  sections?: ('summary' | 'statistics' | 'pivot_tables' | 'insights')[];
}

interface GenerateReportResult {
  reportId: string;
  format: string;
  content: string;
  downloadUrl?: string;
  insights: string[];
}
```

**报告章节**：
- **summary**：数据概览（行数、列数、缺失值、类型分布）
- **statistics**：详细统计（分位数、频次分布、相关性矩阵）
- **pivot_tables**：透视表全量数据
- **insights**：LLM 基于完整探索结果生成的洞察（不是凭空生成）

---

## 五、Skill 设计

### 5.1 设计理念

Skill 不写死"第 1 步做 X，第 2 步做 Y"，而是告诉 LLM：
- "先看 DataProfile，理解数据含义"
- "根据数据特征和用户问题，自己决定怎么分析"
- "可以生成 1 个或多个透视表，取决于数据维度"

### 5.2 excel_profiling（数据理解）

```markdown
---
name: excel_profiling
description: "Excel 数据理解。流式解析文件，提取数据特征，推断业务含义。"
tools: [profile_excel]
parameters:
  type: object
  properties:
    document_id:
      type: string
      description: "Excel 文档 ID"
  required: [document_id]
---

# Excel 数据理解 Skill

## 执行步骤

1. 调用 `profile_excel`，获取 DataProfile

2. 分析数据特征：
   - 数据结构：多少个 Sheet？每个 Sheet 多少行/列？类型分布？缺失值？
   - 业务含义推断：根据列名和样本推断每列含义，推断整体业务场景
   - 潜在分析方向：哪些列适合做维度？哪些列适合做值？

3. 输出：DataProfile + 业务场景推断 + 建议的分析方向
```

### 5.3 excel_analysis（三阶段智能分析）

```markdown
---
name: excel_analysis
description: "Excel 三阶段智能分析。数据画像 → 深度探索（多轮 SQL）→ 透视表 + 报告。"
tools: [profile_excel, execute_query, create_pivot, generate_report]
parameters:
  type: object
  properties:
    document_ids:
      type: array
      items: { type: string }
      description: "Excel 文档 ID 列表（支持多文件）"
    question:
      type: string
      description: "用户问题或分析需求（可选）"
    format:
      type: string
      enum: [markdown, json, excel]
      default: markdown
  required: [document_ids]
---

# Excel 三阶段智能分析 Skill

核心原则：
- 不要假设数据结构，先看 DataProfile
- 不要一次性获取所有数据，多轮探索，逐步深入
- 所有数据获取通过 SQL（execute_query），保证不遗漏
- 基于完整探索结果生成透视表和报告

## 阶段 1：数据画像

调用 `profile_excel` 获取 DataProfile。
理解数据结构、推断业务含义、识别数据特征。

## 阶段 2：深度探索（多轮 SQL）

根据 DataProfile 和用户问题，生成多轮 SQL 逐步深入。

探索策略（按需选择）：
- 分布分析：CASE WHEN 分桶 + GROUP BY
- 峰值分析：ORDER BY ... DESC LIMIT N
- 异常值检测：WHERE 值 > P99
- 趋势分析：DATE_TRUNC + GROUP BY
- 相关性分析：CORR() 函数
- 分组统计：多维度 GROUP BY + 聚合函数
- 跨 Sheet/跨文件：JOIN

每轮探索后判断是否需要更多数据，直到获取完整数据视图。

## 阶段 3：透视表 + 报告

基于阶段 2 的探索结果：
- 用 `create_pivot` 或 `execute_query` 生成透视表
- 用 `generate_report` 生成分析报告
- 透视表全量返回（不截断）
```

---

## 六、大数据处理

### 6.1 流式解析

```typescript
// ❌ 全量加载：100MB → OOM
const workbook = XLSX.readFile(filePath);

// ✅ 流式解析：内存恒定 ~50MB
const stream = XLSX.stream.to_csv(workbook.Sheets[sheetName]);
let chunk = [];
for await (const row of stream) {
  chunk.push(row);
  if (chunk.length >= 1000) {
    await duckdb.insertChunk(tableName, chunk);
    chunk = [];
  }
}
```

### 6.2 不遗漏保证

```
流式解析 → 所有行写入 DuckDB（不截断）
  ↓
SQL 聚合 → 数据库层执行（覆盖所有行）
  ↓
聚合结果 → 远小于原始数据 → 全量存入 PostgreSQL
```

### 6.3 数据生命周期

| 数据 | 保留策略 |
|---|---|
| DuckDB 临时表 | 7 天后自动清理 |
| DataProfile / 透视表 / 报告 | 永久保留 |

---

## 七、API 设计

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/excel/profiles/:id` | 获取 DataProfile |
| GET | `/api/excel/profiles/:id/sample?limit=10` | 获取样本数据（DuckDB 查询） |
| DELETE | `/api/excel/profiles/:id` | 删除 Profile + DuckDB 临时文件 |
| GET | `/api/excel/pivots/:id` | 获取透视表全量数据 |
| GET | `/api/excel/pivots/:id/download?format=excel` | 下载透视表 |
| DELETE | `/api/excel/pivots/:id` | 删除透视表 |
| GET | `/api/excel/reports/:id` | 获取报告内容 |
| GET | `/api/excel/reports/:id/download` | 下载报告 |

---

## 八、示例场景

### 场景 1：销售数据（多维度，深度探索）

DataProfile：日期、产品、区域、金额、数量
用户问题："分析销售情况"

```
阶段 1：DataProfile 显示金额 avg=1234, P99=15000, max=99999 → 右偏分布

阶段 2：多轮探索
  第 1 轮：异常值（金额 > 15000）→ 156 条，集中在华东+高端产品
  第 2 轮：月度趋势 → 12 月最高，2 月最低
  第 3 轮：区域×产品分布 → 华东高端产品占 45%

阶段 3：生成 4 个透视表 + 报告
  透视表：按区域汇总 / 按产品汇总 / 月度趋势 / 区域×产品交叉
  报告洞察："华东高端产品是主要收入来源，存在 156 条异常大值..."
```

### 场景 2：考勤数据（单维度，简单分析）

DataProfile：工号、姓名、部门、日期、状态
用户问题："统计各部门出勤率"

```
阶段 1：状态分布 → 正常 85%、迟到 10%、缺勤 5%；10 个部门

阶段 2：1 轮探索
  SQL: SELECT 部门, COUNT(CASE WHEN 状态='正常' THEN 1 END) * 100.0 / COUNT(*)
       FROM excel_abc_0 GROUP BY 部门

阶段 3：1 个透视表 + 报告
  洞察："研发部出勤率最低（78%），建议关注"
```

### 场景 3：12 个月度报表（格式相同，合并分析）

DataProfile：merged=true，12 个文件已合并

```
阶段 2：多轮探索
  第 1 轮：年度汇总 → 总销售额、总订单数
  第 2 轮：月度趋势 → 12 个月数据
  第 3 轮：产品 Top 10

阶段 3：2 个透视表 + 报告（年度总结 + 趋势 + Top 10）
```

### 场景 4：多 Sheet 跨表关联

Sheet1（销售：日期、产品、金额、客户ID）+ Sheet2（客户：客户ID、名称、区域、行业）

```
阶段 2：跨 Sheet JOIN
  SQL: SELECT c.区域, SUM(s.金额) FROM excel_doc1_0 s
       JOIN excel_doc1_1 c ON s.客户ID = c.客户ID
       GROUP BY c.区域

阶段 3：透视表 + 报告（区域分析 + 行业分析）
```

---

## 九、实现计划

### 9.1 分步实现

| Step | 内容 | 工作量 |
|---|---|---|
| 1 | ExcelParser 流式解析（xlsx SAX 模式） | 2 天 |
| 2 | DuckDBService 集成（连接管理 + SQL 执行 + 安全校验） | 1.5 天 |
| 3 | excel_profiles / pivot_tables / excel_reports Schema + 迁移 | 1 天 |
| 4 | profile_excel Tool（流式解析 + 丰富统计特征 + DuckDB 写入） | 2.5 天 |
| 5 | execute_query Tool（LLM 生成任意 SQL + 多轮探索） | 1.5 天 |
| 6 | create_pivot Tool（配置 → SQL → 结果持久化） | 1.5 天 |
| 7 | generate_report Tool（Markdown/JSON/Excel 导出） | 2 天 |
| 8 | 2 个 Skill（excel_profiling + excel_analysis 三阶段） | 2.5 天 |
| 9 | ExcelAgent 子 Agent 注册 + 集成 | 1 天 |
| 10 | API 路由 + 下载功能 + 清理任务 | 1.5 天 |
| 11 | 集成测试（大文件、多格式、多轮探索、不遗漏验证） | 2.5 天 |

**总计**：约 19 天

### 9.2 依赖库

```json
{
  "xlsx": "^0.18.5",
  "duckdb": "^0.10.0"
}
```

### 9.3 关键验证点

| 验证项 | 方法 | 预期 |
|---|---|---|
| 流式解析不 OOM | 100 万行，监控内存 | < 100MB |
| 聚合不遗漏 | SUM 对比 Excel 公式 | 结果一致 |
| 格式自适应 | 10 种不同格式 Excel | 全部成功 profiling |
| 多轮探索 | 销售数据，验证 LLM 生成 SQL | 3+ 轮逐步深入 |
| 洞察准确性 | 验证报告洞察基于探索数据 | 与实际数据一致 |
| SQL 安全 | 尝试 INSERT/DELETE | 被拒绝 |

---

## 十、风险与缓解

| 风险 | 缓解措施 |
|---|---|
| Excel 格式复杂（合并单元格、嵌套表头） | 流式解析 + 容错（跳过异常行），支持常见格式 |
| 大数据集 OOM | 流式解析（< 100MB）+ DuckDB 列式存储 |
| DuckDB 临时文件占满磁盘 | 7 天自动清理 + 磁盘监控 |
| LLM 幻觉（错误洞察） | 限制只能基于实际探索数据生成洞察 |
| SQL 注入 | 只允许 SELECT + 语法检查 |
| 透视表聚合错误 | 单元测试覆盖所有聚合方式 + 对比 Excel 验证 |

---

## 十一、扩展能力（Phase 2）

| 功能 | 描述 |
|---|---|
| 图表生成 | 基于透视表生成图表（ECharts/Chart.js） |
| 多 Sheet 关联 | 跨 Sheet JOIN（DuckDB 原生支持） |
| 模板化报告 | 预定义报告模板（销售分析、财务报表等） |
| 增量分析 | 新数据追加后自动更新透视表和报告 |
| 并行处理 | 多 Sheet 并行解析、多透视表并发生成 |
