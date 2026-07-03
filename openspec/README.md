# OpenSpec — 设计文档规范

轻量级设计文档规范。核心问题：Agent 改了代码但没留下设计决策记录，下次另一个 Agent 来改，不知道上次为什么这样做。

---

## 三种文档类型

| 类型 | 目录 | 何时使用 | 需要确认 |
|------|------|---------|---------|
| **add** | `openspec/add/` | 新增功能 | ✅（确认后再实现） |
| **change** | `openspec/change/` | 架构级改动 | ✅（确认后再改） |
| **changelog** | `openspec/changelog/` | 任何代码变更的记录 | ❌（与代码同批完成） |

### add vs change

- **add**：新增一个之前不存在的能力。如「添加用户搜索功能」
- **change**：改变已有的架构或设计。如「把认证从 session 换成 JWT」
- **changelog**：两者完成后都写，Bug 修复也写

---

## 命名规则

格式：`{YYYYMMDD}-{项目缩写}-{描述}.md`

**示例：**
```
20260703-backend-multi-dataset-search.md    # 多 dataset 检索
20260703-core-access-control.md             # 权限隔离
20260704-deploy-monitoring.md               # 监控接入
```

### 项目缩写表（KB-Core）

| 缩写 | 范围 |
|------|------|
| `backend` | 后端 API、Worker、数据库 |
| `core` | 核心业务逻辑（Agent/Skill/Tool） |
| `pipeline` | 入库流水线、队列 |
| `deploy` | 部署、基础设施 |
| `global` | 全项目、跨模块、文档 |

---

## 使用原则

### 设计先行

功能实现前先写 `openspec/add/`：
1. **被迫思考** — 写文档就是梳理设计，发现动手时才会遇到的问题
2. **可追溯** — 以后另一个 Agent 来看，知道当时为什么这样做
3. **可讨论** — 用户先看设计，确认方向后再实现

### 变更必记

任何代码变更都写 changelog：
- changelog 不只是「做了什么」，更重要的是「为什么这样做」
- 下一个 Agent（或三个月后的你）需要这些信息来做决策
- 批量事后补 changelog 必然遗漏关键决策上下文

### 不可后补

changelog 必须和代码变更同批完成。不允许「先改代码，回头补文档」。

---

## 目录结构

```
openspec/
├── README.md                              # 本文件
├── add/
│   ├── _template.md                       # 新功能设计文档模板
│   └── 20260703-xxx-feature.md           # 实际文档
├── change/
│   ├── _template.md                       # 架构改动文档模板
│   └── 20260703-xxx-refactor.md          # 实际文档
└── changelog/
    ├── _template.md                       # 变更日志模板
    └── 20260703-backend-fix-bug.md       # 实际文档
```

---

## 模板

所有模板见 `_template.md` 文件（add/ change/ changelog/ 各一份）。
创建文档时复制对应模板，填入项目缩写、日期和具体内容。
