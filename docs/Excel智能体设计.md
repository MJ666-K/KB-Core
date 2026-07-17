# Excel 智能体设计文档

> 基于 Agent/Skill/Tool 架构的 Excel 智能分析系统，支持任意格式、任意大小的 Excel 文件。

---

## 一、核心能力

| 能力 | 实现方式 |
|---|---|
| **格式自适应** | Agent 自动识别列类型，智能生成 SQL/代码 |
| **大数据处理** | DuckDB 流式解析，SQL 聚合不遗漏 |
| **智能查询** | 双模式：SQL（简单）+ Python 代码（复杂） |
| **自动分析** | 上传即生成透视表 + 分析报告 |
| **多轮追问** | 基于已有数据继续深入分析 |

---

## 二、系统架构

```
┌─────────────────────────────────────────────────────┐
│                  前端界面                             │
│  上传 Excel → 查看透视表/报告 → 追问分析              │
└────────────────────┬────────────────────────────────┘
                     │ HTTP API
┌────────────────────▼────────────────────────────────┐
│              后端 API（Hono）                         │
│  POST /upload    - 上传并自动分析                     │
│  GET  /result/:id - 获取完整结果                      │
│  POST /query     - 追问查询（SQL/代码）               │
└────────────────────┬────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
┌───────▼────────┐      ┌────────▼────────┐
│   Tool 层      │      │   Skill 层      │
│                │      │                 │
│ query_excel    │◄─────│ excel_analysis  │
│ (SQL 查询)     │      │ (分析编排)      │
│                │      │                 │
│ generate_code  │      └─────────────────┘
│ (代码生成)     │
└───────┬────────┘
        │
┌───────▼────────┐
│   DuckDB       │
│   分析引擎     │
└────────────────┘
```

---

## 三、核心组件

### 3.1 Tool：query_excel

**功能**：智能 SQL 查询，自动类型转换

**输入**：
```json
{
  "profileId": "xxx",
  "question": "按区域统计销售额"
}
```

**处理流程**：
1. 获取 Excel 表结构（列名、类型）
2. LLM 生成 SQL（自动添加 CAST 类型转换）
3. DuckDB 执行查询
4. 返回结果 + SQL + 解释

**智能类型转换**：
```sql
-- 数值列聚合自动转换
SELECT "区域", SUM(CAST("金额" AS DOUBLE)) as 总销售额
FROM table GROUP BY "区域"

-- 日期列自动转换
SELECT CAST("日期" AS DATE) as 时间, ...
```

**输出**：
```json
{
  "success": true,
  "sql": "SELECT ...",
  "rows": [...],
  "rowCount": 10,
  "explanation": "按区域分组计算销售额总和"
}
```

### 3.2 Tool：generate_code

**功能**：生成并执行 Python 代码，处理复杂分析

**输入**：
```json
{
  "profileId": "xxx",
  "question": "计算每个产品的月环比增长率"
}
```

**处理流程**：
1. LLM 生成 Python 代码（使用 duckdb + pandas）
2. 写入临时文件
3. 执行代码（30秒超时）
4. 返回执行结果

**输出**：
```json
{
  "success": true,
  "code": "import duckdb\n...",
  "output": "执行结果..."
}
```

### 3.3 Skill：excel_analysis

**功能**：编排 Tool，智能选择分析方式

**决策逻辑**：
- 简单查询（统计、汇总）→ `query_excel`
- 复杂分析（同比环比、机器学习）→ `generate_code`

---

## 四、数据流

### 4.1 上传并自动分析

```
用户上传 Excel
  ↓
ExcelParser 解析（流式）
  ↓
写入 DuckDB 临时表
  ↓
自动生成透视表（按分类汇总、交叉分析、时间趋势）
  ↓
LLM 生成分析报告
  ↓
保存到 PostgreSQL
  ↓
返回完整结果
```

### 4.2 追问查询

```
用户输入问题
  ↓
选择模式（SQL/代码）
  ↓
├─ SQL 模式：LLM 生成 SQL → DuckDB 执行
└─ 代码模式：LLM 生成 Python → 执行代码
  ↓
返回结果（表格 + 图表）
```

---

## 五、数据库设计

### 5.1 excel_profiles（数据画像）

```typescript
{
  id: string,
  fileNames: string[],        // 文件名列表
  sheets: [{
    sheetName: string,
    rowCount: number,
    columns: [{
      name: string,
      type: 'string' | 'number' | 'date',
      uniqueCount: number
    }],
    duckdbTable: string       // DuckDB 表名
  }]
}
```

### 5.2 pivot_tables（透视表）

```typescript
{
  id: string,
  profileId: string,
  name: string,               // 透视表名称
  rows: Record<string, unknown>[],  // 全量数据
  rowCount: number,
  visualization: {
    chartType: 'bar' | 'line' | 'heatmap',
    categories: string[],
    series: [{ name: string, data: number[] }]
  },
  sql: string                 // 生成 SQL
}
```

### 5.3 excel_reports（分析报告）

```typescript
{
  id: string,
  profileId: string,
  title: string,
  content: string,            // Markdown 内容
  pivotTableIds: string[]
}
```

---

## 六、前端界面

### 6.1 布局

```
┌─────────────────────────────────────────┐
│  顶部：标题 + 刷新按钮                   │
├──────────┬──────────────────────────────┤
│ 左侧     │ 右侧                         │
│          │                              │
│ 上传按钮 │ Tab 切换                     │
│          │ ┌────┬────┬────┬────┐       │
│ 历史列表 │ │预览│透视│报告│追问│       │
│          │ └────┴────┴────┴────┘       │
│          │                              │
│          │ 内容区                       │
│          │                              │
└──────────┴──────────────────────────────┘
```

### 6.2 功能

- **数据预览**：表格展示原始数据
- **透视表**：D3 图表 + ECharts 图表 + 数据表
- **分析报告**：Markdown 渲染 + 源码查看
- **追问**：对话式交互，支持 SQL/代码切换

---

## 七、关键技术

### 7.1 智能类型转换

**问题**：DuckDB 对类型要求严格，`SUM(VARCHAR)` 会报错

**解决**：LLM 生成 SQL 时自动添加 CAST

```typescript
function generateColumnExpression(columnName: string, columnType: string) {
  if (columnType === 'number') {
    return `CAST("${columnName}" AS DOUBLE)`;
  } else if (columnType === 'date') {
    return `CAST("${columnName}" AS DATE)`;
  }
  return `"${columnName}"`;
}
```

### 7.2 双模式查询

**SQL 模式**（简单查询）：
- 快速响应
- 适合统计、汇总、分组

**代码模式**（复杂分析）：
- 生成 Python 代码
- 支持 pandas、numpy
- 适合同比环比、机器学习

### 7.3 D3 3D 图表

集成 D3.js，支持：
- 3D 柱状图
- 热力图
- 散点图
- 自定义可视化

---

## 八、API 接口

### 8.1 上传并分析

```http
POST /api/excel/upload
Content-Type: multipart/form-data

file: Excel 文件
```

**响应**：
```json
{
  "success": true,
  "profileId": "xxx",
  "fileName": "销售数据.xlsx",
  "totalRows": 12000,
  "pivots": [...],
  "report": {...}
}
```

### 8.2 获取结果

```http
GET /api/excel/result/:profileId
```

**响应**：
```json
{
  "success": true,
  "profile": {...},
  "pivots": [...],
  "report": {...}
}
```

### 8.3 追问查询

```http
POST /api/excel/query
Content-Type: application/json

{
  "profileId": "xxx",
  "question": "哪个区域销售最高？",
  "useCode": false
}
```

**响应**：
```json
{
  "success": true,
  "sql": "SELECT ...",
  "rows": [...],
  "explanation": "..."
}
```

---

## 九、文件清单

### 后端

| 文件 | 说明 |
|---|---|
| `app/src/routes/excel.ts` | API 路由 |
| `app/src/tools/excel/query-excel.ts` | SQL 查询 Tool |
| `app/src/tools/excel/generate-code.ts` | 代码生成 Tool |
| `app/src/skills/excel-analysis/SKILL.md` | 分析 Skill |
| `app/src/parser/excel-parser.ts` | Excel 解析器 |
| `app/src/analyze/duckdb-service.ts` | DuckDB 服务 |

### 前端

| 文件 | 说明 |
|---|---|
| `status/src/pages/ExcelAnalysis.tsx` | 分析页面 |

### 数据库

| 表 | 说明 |
|---|---|
| `excel_profiles` | 数据画像 |
| `pivot_tables` | 透视表 |
| `excel_reports` | 分析报告 |

---

## 十、使用示例

### 示例 1：上传并自动分析

1. 访问 http://localhost:5173/excel
2. 点击"上传 Excel"
3. 选择文件（如 `资金流水表.xlsx`）
4. 等待分析完成（约 3-5 秒）
5. 查看结果：
   - **数据预览**：原始数据表格
   - **透视表**：自动生成的图表
   - **分析报告**：LLM 生成的分析

### 示例 2：追问分析

1. 切换到"追问"标签
2. 输入问题："哪个区域销售最高？"
3. 选择模式：
   - **SQL 模式**：简单查询
   - **代码模式**：复杂分析
4. 点击"发送"
5. 查看结果：SQL/代码 + 表格

### 示例 3：查看报告源码

1. 切换到"分析报告"标签
2. 点击右上角"源码"按钮
3. 查看 Markdown 源码
4. 点击"预览"切换回渲染视图

---

## 十一、技术栈

| 层面 | 技术 |
|---|---|
| 前端 | React + Ant Design + ECharts + D3.js |
| 后端 | Bun + Hono + TypeScript |
| 数据库 | PostgreSQL + DuckDB |
| LLM | OpenAI 兼容 API |
| 解析 | xlsx (SAX 模式) |

---

## 十二、性能指标

| 指标 | 目标 |
|---|---|
| 解析速度 | 12000 行 < 3 秒 |
| 内存占用 | < 100MB |
| 查询响应 | < 2 秒 |
| 代码执行 | < 30 秒 |

---

## 十三、扩展方向

- [ ] 支持更多图表类型（3D 散点、桑基图等）
- [ ] 支持导出 Excel/PDF
- [ ] 支持批量文件上传
- [ ] 支持数据清洗（缺失值、异常值）
- [ ] 支持预测分析（时间序列、回归）

---

**文档版本**：v2.0  
**最后更新**：2026-07-13  
**维护者**：KB-Core Team
