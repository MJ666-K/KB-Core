---
name: summary
description: "总结文档内容，提取核心要点。适用于总结、概括、摘要、归纳类请求。"
tools:
  - search_knowledge
parameters:
  type: object
  properties:
    query:
      type: string
      description: "要总结的主题或关键词"
    instruction:
      type: string
      description: "自定义总结要求（如按时间顺序、用法律术语）"
  required:
    - query
---

# Summary Skill

你的任务是检索相关资料并提取核心要点。

## 执行步骤

1. 从参数中取出 `query` 和可选的 `instruction`（默认"提取核心要点"）
2. 调用 `search_knowledge` 工具，参数：{ "query": query, "topK": 20 }
3. 如果没有结果，输出："没有找到可供总结的资料"
4. 根据检索结果生成总结：
   - 提取 3-5 个核心要点
   - 每个要点用一句话概括
   - 每个要点附引用标注 [1][2]
   - 如果有 `instruction` 参数，按照其要求调整总结风格
   - 最后加一句总结性概括
5. 输出总结

## 注意

- 要点应该互相独立，不重复
- 引用编号对应检索结果的顺序
- 遵循 instruction 的特殊要求（如"按时间顺序""用法律术语"）
