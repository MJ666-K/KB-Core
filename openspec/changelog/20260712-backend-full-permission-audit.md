# 变更日志：全量 API 权限校验审计

## 背景

除 documents 外，多数 API 路由仅有登录校验、无 `requirePermission`，与权限注册表定义不一致。

## 修复映射

| 权限 | API 路由 |
|------|----------|
| `dashboard:view` | `GET /api/stats` |
| `chat:use` | `/api/chat/*`, `/api/sessions/*`, `/api/query/*`, WebSocket 鉴权 |
| `kg:view` | `/api/kg/*`（读操作，已有） |
| `settings:manage` | `GET/PUT /api/settings`, `POST /api/kg/ingest`, `POST /api/datasets` |
| `documents:read` | `GET /api/documents/*` |
| `documents:write` | `DELETE/POST reingest /api/documents/*`, `POST /ingest` |
| `agents:manage` | `/api/agents/*`, `POST /api/reload` |
| `models:manage` | `POST/PUT/DELETE /api/models/*` |
| `models:manage` \| `agents:manage` | `GET /api/models/*`（智能体配置需读模型列表） |
| `skills:manage` | `/api/skills/*`, `/api/skill-meta/*` |
| `users:manage` | `/api/users/*`（已有） |
| `roles:manage` | `/api/roles/*`（已有） |
| 多权限 OR | `GET /api/datasets`（文档/智能体/配置页依赖） |

## 前端

- 文档库：写操作需 `documents:write`（已有）
- 智能体/模型/Skills/参数配置：写操作按钮按对应 manage 权限隐藏
- 文档库菜单：仅需 `documents:read`

## 新增

- `requireAnyPermission(...)` 中间件
