# KB-Core 冒烟测试报告

> **测试时间**：2026-07-01 13:05:29
> **API 基址**：http://localhost:3000
> **WebSocket**：ws://localhost:3000/ws/query
> **对外接口**：`POST /ingest` · `WS /ws/query` · `GET /health`

## 总览

| 指标 | 值 |
|---|---|
| 用例总数 | 6 |
| 通过 | 6 |
| 失败 | 0 |
| 通过率 | 100% |

## 用例明细

| ID | 用例 | 结果 | 耗时 | 说明 |
|---|---|---|---|---|
| S1 | GET /health | ✅ PASS | 0ms | status=ok |
| S2 | POST /ingest | ✅ PASS | 17ms | docId=4d2be270 status=pending |
| S3 | WS 连接 /ws/query | ✅ PASS | 2ms | ws://localhost:3000/ws/query |
| S4 | WS 非法消息校验 | ✅ PASS | 1ms | Invalid JSON |
| S5 | WS 对话（chat） | ✅ PASS | 5372ms | termination=direct citations=0 len=249 |
| S6 | WS 检索问答（qa） | ✅ PASS | 27897ms | termination=skill citations=0 len=677 |

## 问答摘要

### S5 WS 对话（chat）

> 你好！👋 我是你的法律知识库助手，专注于为你提供中国法律法规的查询、解读和分析服务。
> 
> 我可以帮你做这些事情：
> 
> - **法条问答**：查询具体法律规定、法条内容、权利义务等
> - **法条检索**：按关键词搜索法律法规原文条款
> - **法律对比**：对比不同法律或条款之间的差异
> - **要点总结**：归纳某部法律或某类规则的核心内容
> - **深度推理**：分析涉及多部法律交叉的复杂问题
> 
> 无论是想了解具体法条、对比不同规定，还是梳理法律要点，都可以直接问我。请问有什么法律问题需要我帮你解答？

### S6 WS 检索问答（qa）

> 根据《中华人民共和国社会保险法（2018年修订本）》的规定，国家建立了以下五种社会保险制度：
> 
> ---
> 
> ### 五大社会保险种类
> 
> 根据《中华人民共和国社会保险法》**第二条**规定：
> 
> > "国家建立**基本养老保险、基本医疗保险、工伤保险、失业保险、生育保险**等社会保险制度，保障公民在年老、疾病、工伤、失业、生育等情况下依法从国家和社会获得物质帮助的权利。"[1]
> 
> 具体对应关系如下：
> 
> | 保险种类 | 保障情形 | 法律章节 |
> |---------|---------|---------|
> | **基本养老保险** | 年老 | 第二章（第10-22条） |
> | **基本医疗保险…


## 接口速查

### POST /ingest
```bash
curl -X POST http://localhost:3000/ingest -F "file=@doc.txt" -F "dataset=default"
```

### WS /ws/query
```json
{ "type": "query", "question": "你的问题" }
```

---
*由 `bun tests/smoke.ts` 自动生成*
