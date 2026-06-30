# 测试数据集（Phase 1）

本目录存放用于开发与测试的 TXT 文档。文档内容刻意设计为可覆盖六个 Skill 的典型场景，便于端到端验证「入库 → 检索 → Agent 问答」闭环。

## 文件清单

| 文件 | 主题 | 主要覆盖的 Skill / 场景 |
|---|---|---|
| `docker.txt` | Docker 容器技术（优缺点、适用场景）| `qa`、`compare`（与 k8s 对比）|
| `kubernetes.txt` | Kubernetes 编排（优缺点、适用场景）| `qa`、`compare`（与 docker 对比）|
| `labor-law.txt` | 劳动合同解除与经济补偿（含立法目的）| `qa`（事实问答）、`multihop`（「为什么双倍赔偿」多跳推理）、`summary` |
| `rag-basics.txt` | RAG / 向量检索 / RRF / 分块基础 | `qa`、`search`（纯检索片段）、`summary`（要点提取）|

## 建议的测试问题（对照预期行为）

| 测试问题 | 预期 Agent 行为 |
|---|---|
| 「你好」 | `chat`，不检索，直接回答 |
| 「Docker 是什么？」 | `qa`，检索 docker.txt，带引用 |
| 「对比 Docker 和 K8s 在微服务部署上的优缺点」 | `compare`，拆子问题 → 各自检索 → 生成对比表格 |
| 「违法解除劳动合同怎么赔偿？为什么这样规定？」 | 组合 `qa` + `multihop` |
| 「总结一下 RAG 的核心思想」 | `summary`，过取上下文 → 要点提取 |
| 「检索一下 RRF 融合」 | `search`，返回相关片段 |

## 说明

- Phase 1 仅支持 TXT 解析，故数据均为 `.txt`。
- 内容为便于测试编写的说明性文本，事实表述以测试为目的，非权威法律/技术依据。
- 新增测试文档请同步更新本表，并标注其覆盖的 Skill 场景。
