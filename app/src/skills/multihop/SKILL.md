---
name: multihop
description: "多跳深度推理。迭代检索直到信息充分。适用于需要跨文档推理的复杂分析问题。"
tools:
  - search_knowledge
parameters:
  type: object
  properties:
    query:
      type: string
      description: "复杂分析问题"
    maxIterations:
      type: number
      description: "最大检索轮次，默认 3，范围 1-5"
      default: 3
  required:
    - query
---

# MultiHop Skill

你的任务是通过多轮迭代检索，收集足够信息后综合回答一个复杂分析问题。

## 执行步骤

1. 从参数中取出 `query` 和 `maxIterations`（默认 3，最大 5）
2. 分析原始问题，确定第一个搜索方向
3. 循环（最多 maxIterations 轮）：
   a. 评估当前已有信息是否足够回答问题
   b. 如果足够，跳到步骤 4
   c. 如果不足，确定下一步需要搜索什么（换关键词、换角度）
   d. 调用 `search_knowledge`，参数：{ "query": "<新的搜索关键词>", "topK": 5 }
   e. 合并新结果到已有资料中
4. 综合所有轮次收集的资料，生成完整回答：
   - 展示推理过程（"根据 [1] 和 [2] 可以推断..."）
   - 标注引用 [1][2][3]
   - 如果信息仍不完整，明确说明哪些部分缺乏资料
5. 输出最终回答

## 注意

- 每轮搜索要换不同的关键词或角度，不要重复搜索相同的内容
- 优先搜索问题的核心概念，再搜索关联概念
- 如果是最后一轮（第 maxIterations 轮），必须停止搜索并合成答案
- 回答要展示推理链条，不是简单堆砌资料
