---
name: project-docs
version: 3.0.0
description: >-
  通用 AI Agent 协作文档框架。当用户要求查看项目、初始化文档体系、生成 AGENTS.md 或
  PROJECT.md、写设计文档、记录变更日志、配置多 Agent 协作规则时，必须使用此 Skill。
  新项目第一次建立文档体系、已有项目文档维护更新，都需要先加载此 Skill。
  任何涉及 changelog、OpenSpec、变更管理、并行开发分工的操作，即使没有明确
  提到这些关键词，只要语义相关也要触发。Triggers on: 查看项目, 生成 AGENTS.md,
  写设计文档, 记录变更日志, 多 Agent 协作, 初始化文档体系, 创建 PROJECT.md,
  新功能设计, 记录 changelog, 项目文档规范, 协作规则, 交接协议。
---

# 项目文档协作系统

## 适用场景

- 首次进入项目，需要了解全局上下文
- 新增功能，需要写设计文档再实现
- 修复 Bug 或做架构改动，需要记录变更
- 生成或更新 AGENTS.md / PROJECT.md
- 多个 AI Agent 并行开发，需要分工协作与交接

## 项目文档体系

```
{项目根目录}/
├── PROJECT.md                   # 全项目入口：模块概览、目标、技术栈
├── AGENTS.md                    # AI Agent 工作规则（项目级配置）
├── openspec/
│   ├── README.md                # OpenSpec 规范说明
│   ├── add/                     # 新功能设计文档
│   ├── change/                  # 架构级改动文档
│   └── changelog/               # 变更日志
└── docs/                        # 业务规则与领域知识
```

**核心原则：文档是 Agent 的唯一上下文来源。没有文档，Agent 就是在盲猜。**

文档层级自上而下：

```
PROJECT.md → AGENTS.md → openspec/ → docs/ → 源代码
```

铁律：**从上层往下读，不直接跳进代码。任何代码变更必须同步写 changelog。**

---

## 入驻流程（Agent 必做）

每个 Agent 进入项目时，按顺序执行以下步骤，不可跳过：

1. 读 `PROJECT.md` → 建立全局认知：项目是什么、有哪些模块、技术栈
2. 读 `AGENTS.md` → 掌握项目规则、铁律、测试命令
3. 浏览 `openspec/changelog/` 最近 5 条 → 了解近期变更脉络
4. 涉及业务规则 → 读 `docs/` 下相关文档
5. 最后才读目标源代码

这样做的理由：PROJECT.md 和 AGENTS.md 承载了人类和其他 Agent 沉淀的项目认知。跳过它们直接看代码，容易产生认知偏差。

> 📖 完整入驻流程细节 → `references/onboarding.md`

---

## 变更工作流

### 新功能（add）

```
1. PROJECT.md → AGENTS.md（确认项目约定）
2. openspec/add/ 创建设计文档（命名格式见 OpenSpec 规范）
3. 等待用户确认设计后再实现
4. 实现代码 → 运行测试（命令从 AGENTS.md 读）
5. openspec/changelog/ 记录变更（与代码同批完成）
6. 业务规则变化 → 更新 docs/
7. 新约定 → 追加到 AGENTS.md
```

### 架构级改动（change）

```
1. PROJECT.md → AGENTS.md
2. openspec/change/ 创建改动文档
3. 用户确认 + 回归测试
4. openspec/changelog/ 记录
```

### Bug 修复

```
1. AGENTS.md（必读）
2. 涉及业务语义 → docs/
3. 修复代码 + 回归测试
4. 业务规则变化 → docs/
5. openspec/changelog/ 记录（必须，与代码同批完成）
```

**禁止**：先改代码后补 changelog；跳过 AGENTS.md 直接读源码。理由：changelog 是协作记忆，后置补录容易遗漏关键决策上下文。

---

## 多 Agent 协作（核心）

当多个 Agent 同时工作时，需要协议来避免冲突、确保连续性。

### 三种协作机制

| 机制 | 解决的问题 | 简要规则 |
|------|-----------|---------|
| **角色分工** | 谁做什么 | 按职能划分 Agent 职责，各管各的区域 |
| **交接协议** | 做完怎么交给下一个人 | 阶段完成写交接摘要，接手者先读摘要 |
| **并行规则** | 同时改同一文件怎么办 | 分工不重叠；必须同改则后者先读前者改动 |

### 协作流程

```
设计（Architect）→ 实现（Implementer）→ 测试（QA）→ 文档 + 审查（Doc + Reviewer）
      ↓                    ↓                  ↓
  写 openspec     写代码 + 测试        测试失败 → 交回实现
  交接给实现      交接给测试           通过 → 交接给文档+审查
```

### 交接摘要格式

每个阶段完成时，产出的交接摘要需包含：

```markdown
## 交接摘要
- **阶段**：设计 / 实现 / 测试 / 审查
- **完成者**：[Agent 角色]
- **做了什么**：[简要描述]
- **改动的文件**：[文件列表]
- **接手者注意**：[特殊事项]
- **未解决问题**：[如有]
```

> 📖 完整协作协议、角色定义、冲突处理 → `references/multi-agent-protocol.md`

---

## AGENTS.md 维护

AGENTS.md 是每个项目的"Agent 宪法"——Agent 的一切行为规则都在这里定义。

生成或更新 AGENTS.md 时，须包含以下章节：

1. **项目身份**：名称、技术栈、目录结构
2. **核心约定**：铁律、编码规范、命名规则
3. **测试命令**：各模块的测试/lint/build 命令
4. **AI 工作流**：入驻顺序 + 变更流程
5. **关键文件位置**：设计文档、配置文件、入口文件
6. **多 Agent 规则**：角色分工、交接约定（如适用）

**探索策略**：并行读取 README、相关 WORKFLOW.md、docs/、package.json 来了解项目。

---

## 参考资料索引

| 文件 | 内容 | 何时查阅 |
|------|------|---------|
| `references/onboarding.md` | Agent 入驻详细流程 | 首次进入项目时 |
| `references/multi-agent-protocol.md` | 多智能体协作完整协议 | 多 Agent 并行工作时 |
| `references/openspec-guide.md` | OpenSpec 规范与命名规则 | 编写设计文档/变更文档时 |
| `references/templates.md` | 全部文档模板 | 创建任何文档时 |

---

## Agent 守则

| 原则 | 要求 | 理由 |
|------|------|------|
| 设计先行 | 新功能必须先写 `openspec/add/` 设计文档 | 先想清楚再动手，减少返工 |
| 设计先行 | 架构改动必须先写 `openspec/change/` | 让所有 Agent 理解变更意图 |
| **变更必记** | 任何代码变更必须同步写 changelog | changelog 是协作记忆，不是事后补作业 |
| 规则必守 | AGENTS.md 铁律不可跳过 | 铁律是项目沉淀，违反必踩坑 |
| 业务同步 | 业务语义变更须更新 docs/ | 业务规则是 Agent 理解领域的关键 |
| 约定同步 | 新约定须追加到 AGENTS.md | 不写下来，下一个 Agent 看不到 |
