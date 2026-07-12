---
name: excel_analysis
description: "Excel 三阶段智能分析。数据画像 → 深度探索（多轮 SQL）→ 透视表 + 报告。支持 2D/3D/交叉表，输出可视化数据。"
tools:
  - profile_excel
  - execute_query
  - create_pivot
  - generate_report
parameters:
  type: object
  properties:
    file_paths:
      type: array
      items: { type: string }
      description: "Excel 文件路径列表（支持多文件）"
    question:
      type: string
      description: "用户问题或分析需求（可选）"
    format:
      type: string
      enum: ["markdown", "json", "excel"]
      default: "markdown"
      description: "报告格式"
  required:
    - file_paths
---

# Excel 三阶段智能分析 Skill

你的任务是通过**三阶段工作流**，深度分析 Excel 数据，生成透视表和报告。

**核心原则**：
- 不要假设数据结构，先看 DataProfile
- **不要一次性获取所有数据**，而是多轮探索，逐步深入
- 所有数据获取必须通过 SQL（`execute_query`），保证不遗漏
- 基于**完整的探索结果**生成透视表和报告，不是基于粗糙的 DataProfile

## 三阶段工作流

### 阶段 1：数据画像（自动化）

调用 `profile_excel` 获取 DataProfile。

**DataProfile 包含**：
- 表头（列名、类型）
- 样本数据（前 10 行）
- 基础统计（null/unique/min/max/avg/median/std）
- 分位数（P25/P50/P75/P90/P95/P99）
- 峰值（Top 10 最大值）
- 分类列频次分布（所有唯一值的频次）
- 日期列时间范围和粒度

**你的任务**：
- 理解数据结构和业务含义
- 识别数据特征（分布、异常、趋势、相关性）
- 决定阶段 2 需要探索什么

### 阶段 2：深度探索（多轮 SQL，LLM 驱动）

**这是核心阶段**。你需要生成多轮 SQL，逐步深入探索数据。

**探索策略**（根据数据特征选择）：

**2.1 分布分析**（数值列）：
```sql
-- 看分布（直方图数据）
SELECT 
  CASE 
    WHEN 金额 < 100 THEN '0-100'
    WHEN 金额 < 1000 THEN '100-1000'
    WHEN 金额 < 10000 THEN '1000-10000'
    ELSE '10000+'
  END as 区间,
  COUNT(*) as 数量,
  AVG(金额) as 平均值
FROM excel_abc_0
GROUP BY 区间
ORDER BY 区间;
```

**2.2 峰值分析**（Top N）：
```sql
-- 看 Top 10 大值
SELECT * FROM excel_abc_0
ORDER BY CAST(金额 AS DOUBLE) DESC
LIMIT 10;
```

**2.3 异常值检测**：
```sql
-- 超出 P99 的异常值
SELECT * FROM excel_abc_0
WHERE CAST(金额 AS DOUBLE) > (
  SELECT PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY CAST(金额 AS DOUBLE))
  FROM excel_abc_0
);
```

**2.4 趋势分析**（时间序列）：
```sql
-- 月度趋势
SELECT 
  DATE_TRUNC('month', 日期) as 月份,
  COUNT(*) as 订单数,
  SUM(CAST(金额 AS DOUBLE)) as 月销售额
FROM excel_abc_0
GROUP BY 月份
ORDER BY 月份;
```

**2.5 分组统计**（多维度）：
```sql
-- 按区域和产品分组
SELECT 
  区域,
  产品,
  COUNT(*) as 订单数,
  SUM(CAST(金额 AS DOUBLE)) as 总金额
FROM excel_abc_0
GROUP BY 区域, 产品
ORDER BY 总金额 DESC;
```

**多轮探索示例**：

```
LLM 看 DataProfile → "金额分布右偏，P99=15000，需要看异常值"

第 1 轮：看异常值
  SQL: SELECT ... WHERE 金额 > 15000 ...
  结果：20 行异常大值
  LLM 判断："有 156 条异常，需要看特征"

第 2 轮：异常值特征
  SQL: SELECT 区域, 产品, COUNT(*) ... WHERE 金额 > 15000 GROUP BY ...
  结果：集中在"华东"+"高端产品"
  LLM 判断："异常值是高端产品大额订单，不是数据错误"

第 3 轮：月度趋势
  SQL: SELECT DATE_TRUNC('month'...) ...
  结果：12 个月趋势
  LLM 判断："数据足够，进入阶段 3"
```

**关键**：
- 每轮探索后，LLM 判断是否需要更多数据
- 不是一次性获取所有数据，而是**逐步深入**
- 探索的目的是获取**完整的数据视图**，用于后续分析

### 阶段 3：透视表 + 报告（基于完整数据视图）

基于阶段 2 的探索结果，生成透视表和报告。

**3.1 生成透视表**：

调用 `create_pivot`，参数：
```json
{
  "profile_id": "<profile_id>",
  "config": {
    "rowFields": ["区域", "产品"],
    "valueField": "金额",
    "aggregation": "sum",
    "chartType": "bar"
  },
  "name": "区域产品销售汇总"
}
```

**3.2 生成报告**：

调用 `generate_report`，参数：
```json
{
  "profile_id": "<profile_id>",
  "pivot_table_ids": ["<透视表 1>", "<透视表 2>"],
  "exploration_summary": "<LLM 总结的探索发现>",
  "format": "markdown",
  "sections": ["summary", "statistics", "pivot_tables", "insights"]
}
```

### 输出结果

返回：
- 探索过程说明（"我进行了 N 轮探索，发现了..."）
- 透视表全量数据（每个表所有行）
- 分析报告（Markdown/JSON/Excel）
