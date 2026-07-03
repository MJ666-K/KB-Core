# 变更日志：初始化 OpenSpec 文档体系

**日期**：2026-07-03
**项目缩写**：global
**类型**：文档更新

## 变更摘要

初始化项目文档体系：创建 PROJECT.md 和 openspec/ 目录结构，为后续变更管理打基础。

## 变更详情

- 创建 `PROJECT.md` — 项目入口（目标、技术栈、模块概览、API、开发进度）
- 创建 `openspec/README.md` — OpenSpec 规范说明 + 命名规则 + 项目缩写表
- 创建 `openspec/add/_template.md` — 新功能设计文档模板
- 创建 `openspec/change/_template.md` — 架构改动文档模板
- 创建 `openspec/changelog/_template.md` — 变更日志模板
- 本文件：初始 changelog

## 影响的文件/模块

| 文件/模块 | 变更类型 | 说明 |
|----------|---------|------|
| `PROJECT.md` | 新增 | 项目入口文档 |
| `AGENTS.md` | 修改 | 补充 OpenSpec 工作流规则 |
| `openspec/README.md` | 新增 | OpenSpec 规范说明 |
| `openspec/add/_template.md` | 新增 | 新功能设计模板 |
| `openspec/change/_template.md` | 新增 | 架构改动模板 |
| `openspec/changelog/_template.md` | 新增 | 变更日志模板 |

## 相关设计文档

无（此为初始化，之前没有 openspec 文档）

## 验证方式

- [x] 文件结构正确（目录 + 模板齐全）
- [x] PROJECT.md 信息来自开发文档/设计文档交叉验证

## 后续工作

- [ ] 开始 Phase 2 时，新功能必须先写 `openspec/add/` 设计文档
