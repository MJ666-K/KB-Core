# 变更日志：KG 虚拟文档原文读取

## 问题

`sourcePath` 为 `kg://{nodeId}` 的文档（图谱法条同步入库）正文存在 `chunks` 表，但 `/api/documents/:id/content` 仍按本地文件读取，导致 ENOENT。

## 修复

- 识别 `kg://` 路径，从该文档的 chunks 按序拼接返回原文
- 禁止对 KG 虚拟文档执行 reingest
