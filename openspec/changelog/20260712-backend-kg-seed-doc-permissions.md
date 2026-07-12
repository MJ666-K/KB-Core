# 变更日志：启动时 KG 空库自动入库 + 文档写操作权限校验

## 问题

1. `app/data/kg-data.json` 不会在启动时自动入库，需手动执行 ingest 脚本或调用 API。
2. 文档删除/重新嵌入/上传 API 仅校验登录，未校验 `documents:write`；前端也未隐藏写操作按钮。

## 修复

- 新增 `seedKgIfEmpty()`：Neo4j 节点数为 0 且存在 `./data/kg-data.json` 时自动入库。
- 文档 API：`documents:read` 读、`documents:write` 写；上传 `/ingest` 同样要求 `documents:write`。
- 文档库页面：无 `documents:write` 时隐藏上传、删除、重新嵌入及多选。
