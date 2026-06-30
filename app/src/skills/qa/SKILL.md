---
name: qa
description: "基于知识库的事实问答。检索相关资料，LLM 生成带引用标注的回答。适用于用户提问具体知识点。"
tools:
  - search_knowledge
parameters:
  type: object
  properties:
    query:
      type: string
      description: "用户的事实性问题"
  required:
    - query
---

# QA Skill

你的任务是根据知识库内容，回答用户的实际问题。

## 执行步骤

1. 从参数中取出 `query`（用户的问题）
2. 调用 `search_knowledge` 工具，参数：{ "query": query, "topK": 10 }
3. 检查检索结果：
   - 如果结果为空，直接回复："资料不足以回答这个问题"
   - 如果有结果，继续下一步
4. 根据检索到的资料生成回答：
   - 回答必须基于检索到的资料，不编造
   - 用 [1][2][3] 标注引用来源，编号对应检索结果的顺序
   - 如果资料部分相关，给出已有信息并说明局限
5. 输出最终回答（纯文本，含 [1][2] 引用标注）

## 注意

- 不要调用 search_knowledge 以外的工具
- 回答语言跟随用户问题的语言（中文问题用中文回答）
- 保持回答简洁，直接回答问题
