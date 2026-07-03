# OpenSpec 规范指南

## 什么是 OpenSpec

OpenSpec 是一套轻量级的设计文档规范，用于在写代码之前先记录"要做什么"和"为什么这样做"。

它解决的核心问题：Agent 改了代码但没留下设计决策的记录，下次另一个 Agent 来改，不知道上次为什么这样做，又重复犯错或做出不同方向的设计。

---

## 三种文档类型

| 类型 | 目录 | 何时使用 | 需要用户确认 |
|------|------|---------|-------------|
| **add** | `openspec/add/` | 新增功能 | 是（确认后再实现） |
| **change** | `openspec/change/` | 架构级改动 | 是（确认后再改） |
| **changelog** | `openspec/changelog/` | 任何代码变更的记录 | 否（与代码同批完成） |

### 何时用 add vs change

- **add**：新增一个之前不存在的能力。比如"添加用户搜索功能"
- **change**：改变已有的架构或设计。比如"把认证从 session 换成 JWT"
- **changelog**：两者完成后都需要写，Bug 修复也需要写

---

## 命名规则

格式：`{YYYYMMDD}-{项目缩写}-{描述}.md`

**示例：**

```
20240315-backend-user-search.md       # 后端用户搜索功能
20240315-fe-dark-mode.md              # 前端暗黑模式
20240316-sync-batch-retry.md          # 同步模块批量重试
20240316-deploy-nginx-ssl.md          # 部署 Nginx SSL 配置
```

### 项目缩写规则

每个项目应在 AGENTS.md 中定义自己的缩写表。默认建议：

| 缩写 | 范围 |
|------|------|
| `global` | 全项目、文档、跨模块 |
| `backend` | 后端 API、Worker、数据库 |
| `fe` | 前端应用 |
| `sync` | 同步模块 |
| `deploy` | 部署、基础设施 |
| `core` | 核心业务逻辑 |

> 根据项目实际模块调整，不必完全遵循。关键是在 AGENTS.md 中统一定义。

---

## 文档目录结构

```
openspec/
├── README.md                              # 说明本规范
├── add/
│   ├── _template.md                       # 新功能设计文档模板
│   └── 20240315-backend-user-search.md   # 实际文档
├── change/
│   ├── _template.md                       # 架构改动文档模板
│   └── 20240316-global-auth-jwt.md       # 实际文档
└── changelog/
    ├── _template.md                       # 变更日志模板
    └── 20240317-backend-fix-search.md    # 实际文档
```

---

## 使用原则

### 设计先行

功能实现前，必须先写 `openspec/add/` 文档。这样做的好处：

1. **被迫思考**：写文档的过程就是梳理设计的过程，能发现很多"动手时才会遇到"的问题
2. **可追溯**：以后另一个 Agent 来看，知道当时为什么这样做
3. **可讨论**：用户可以先看设计，确认方向对了再实现

### 变更必记

任何代码变更，无论大小，都写 changelog。理由：

- changelog 不只是"做了什么"，更重要的是"为什么这样做"
- 下一个 Agent（或三个月后的你）需要这些信息来做决策
- 批量事后补 changelog 必然会遗漏关键决策上下文

### 不可后补

changelog 必须和代码变更同批完成，不允许"先改代码，回头补文档"。

---

## 模板获取

所有模板见 `references/templates.md`，包含：

- 新功能设计文档模板（add）
- 架构改动文档模板（change）
- 变更日志模板（changelog）
- 交接摘要模板

创建文档时复制对应模板，填入项目名称、日期和具体内容。
