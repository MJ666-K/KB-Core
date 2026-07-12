---
name: excel_profiling
description: "Excel 数据理解。流式解析文件，提取数据特征（列类型、统计摘要、分位数、频次分布），推断业务含义。"
tools:
  - profile_excel
parameters:
  type: object
  properties:
    file_paths:
      type: array
      items: { type: string }
      description: "Excel 文件路径列表（支持多文件）"
    document_ids:
      type: array
      items: { type: string }
      description: "文档 ID 列表（可选）"
  required:
    - file_paths
---

# Excel 数据理解 Skill

你的任务是理解 Excel 数据的结构和业务含义，为后续分析提供基础。

## 执行步骤

### 1. 调用 profile_excel
参数：{ "file_paths": file_paths, "document_ids": document_ids }
获取 DataProfile（列特征、样本数据、统计信息）。

### 2. 分析数据特征
基于 DataProfile，回答以下问题：

**数据结构**：
- 有多少个 Sheet？每个 Sheet 有多少行/列？
- 列的数据类型分布（数值/文本/日期/布尔）？
- 缺失值情况（哪些列缺失严重）？

**业务含义推断**（关键）：
- 根据列名和样本数据，推断每列的业务含义
  - 例如："金额"、"price" → 数值型，表示金额
  - 例如："日期"、"create_time" → 日期型，表示时间
  - 例如："区域"、"部门" → 分类型，表示维度
- 推断整个数据集的业务场景
  - 例如：包含"订单号"、"金额"、"客户" → 销售数据
  - 例如：包含"工号"、"姓名"、"考勤" → 人事数据

**潜在分析方向**：
- 哪些列适合做维度（分类型、唯一值少）？
- 哪些列适合做值（数值型）？
- 可能的分析角度（按时间趋势、按维度汇总、交叉分析等）

### 3. 输出 DataProfile + 业务理解
返回：
- DataProfile（原始数据特征）
- 业务场景推断（"这是销售数据，包含..."）
- 建议的分析方向（"建议按区域和产品生成透视表"）
