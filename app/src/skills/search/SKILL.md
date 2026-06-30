---
name: search
description: "纯检索，返回相关文档片段原文，不生成回答。适用于查找、搜索、找资料类请求。"
tools:
  - search_knowledge
parameters:
  type: object
  properties:
    query:
      type: string
      description: "搜索关键词"
    topK:
      type: number
      description: "返回数量，默认 20"
      default: 20
  required:
    - query
---

# Search Skill

你的任务是从知识库中检索相关资料，返回原文片段。不需要生成总结或回答。

## 执行步骤

1. 从参数中取出 `query` 和 `topK`（默认 20）
2. 调用 `search_knowledge` 工具，参数：{ "query": query, "topK": topK }
3. 把检索结果格式化为带编号的文本：
   ```
   [1] (文档标题) 片段原文...
   [2] (文档标题) 片段原文...
   ```
4. 如果没有结果，输出："没有找到相关资料"

## 注意

- 不要自己生成总结或回答，只返回原文片段
- 每条结果保留原始文本，不要改写
- 按相关度排序输出
