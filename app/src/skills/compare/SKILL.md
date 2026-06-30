---
name: compare
description: "对比分析。自动拆分对比对象，分别检索，生成对比表格。适用于 A vs B、对比、区别、优缺点类问题。"
tools:
  - search_knowledge
parameters:
  type: object
  properties:
    query:
      type: string
      description: "对比问题"
    entities:
      type: array
      description: "要对比的对象列表（可选，不传则从 query 推断）"
      items:
        type: string
        description: "对比对象名称"
  required:
    - query
---

# Compare Skill

你的任务是对比两个或多个对象，生成对比表格。

## 执行步骤

1. 从参数中取出 `query` 和可选的 `entities`（对比对象列表）
2. 确定对比对象：
   - 如果有 `entities` 参数，直接使用
   - 如果没有，从 `query` 中推断出对比对象（通常是 2-4 个）
3. 对每个对比对象，分别调用 `search_knowledge`：
   - 参数：{ "query": "<对象名> <query 主题>", "topK": 5 }
   - 例如对比 Docker vs K8s 的微服务部署：搜 "Docker 微服务部署" 和 "K8s 微服务部署"
4. 去重合并所有检索结果
5. 根据资料生成对比分析：
   - 用 Markdown 表格呈现：行 = 对比维度，列 = 对比对象
   - 列出共同点和差异点
   - 标注引用 [1][2]
6. 输出对比分析（Markdown 格式）

## 注意

- 每个对象都要独立检索，不要用一个 query 搜所有
- 对比维度应该有意义（如：定位、适用场景、优点、缺点），不要无意义的对比
- 如果资料不足以对比某些维度，明确说明"资料不足"
