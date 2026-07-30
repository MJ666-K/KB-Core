# 变更日志：问答体验四项修复与增强（流程图渲染 / 内部信息泄露 / 多轮记忆 / 会话上传文档）

**日期**：2026-07-30
**项目缩写**：global
**类型**：Bug 修复 + 功能新增

## 变更摘要

针对用户反馈的四个问答体验问题做系统性修复与增强：① Markdown 流程图偶发无法渲染；② 回答偶发泄露工具名/函数名/权限键值对等系统内部信息；③ 多轮对话答非所问、上下文记忆差；④ 支持会话内上传 PDF/Word/文本作为即时参考资料，并在多轮中持续携带。

## 变更详情

### ① 流程图渲染修复（根因：引用替换污染代码块）

`wrapCitationRefs` 此前对整段 Markdown 盲做全局正则 `[1]` → `[1](#cite-1)`，**包括 mermaid 代码块内部**。LLM 一旦在流程图节点写了 `[1]`，源码即被破坏，`normalizeMermaidSource` 事后 `replace(/\[\d+\]/g,'')` 也救不回来（残留 `(#cite-1)`）——这就是「有时能渲染有时不能」的主因。

修复：抽出共享工具 `codeFence.ts`（split/join/map），令 `wrapCitationRefs`、`normalizeCitationMarkers`、`sanitizeAnswerContent` 全部「代码块感知」，只处理正文、跳过 fenced code block 内部。同时增强 `normalizeMermaidSource`（清除加粗符、全角引号归一、跳过注释行判断类型、扩展支持的图类型）并新增 `repairMermaidSource`：首次 `mermaid.parse` 失败时自动给含特殊字符的未加引号节点标签补引号后重试一次。

### ② 内部信息泄露治理（prompt 硬约束 + 展示层防御双保险）

- 后端：在 `OUTPUT_FORMAT_RULES` 新增「绝对禁止泄露系统内部信息」与「多轮对话纪律」两节，并在默认 Agent prompt、主调度 Agent prompt、自定义 Agent prompt、`RETRIEEVAL_FINAL_HINT`/`NO_RETRIEVAL_FINAL_HINT`/`SYNTHESIS_FINAL_HINT` 全部加入「严禁输出工具名/函数名/权限键值对/编排术语、紧扣当前问题」的约束。
- 前端：重写 `sanitizeAnswerContent` 为代码块感知的展示层防御，清除：函数调用 JSON（`{"name":..,"arguments":..}`、`{"type":"function",..}`）、`tool_calls`/`function_call`、已知权限键值对（`documents:write` 等共 11 项）、snake_case 内部标识（`search_knowledge` 等）、编排日志行（`[Agent] 迭代..`、`调用 X 工具`）。对「内部转储型」代码块整体删除，对合法 mermaid/语言代码块原样保留。

### ③ 多轮记忆修复（根因：Skill 路径完全丢弃历史）

关键 bug：`SkillExecutor` 构建 messages 时只放 `[system, params]`，**完全忽略 `ctx.history`**。由于绝大多数回答经 Skill（qa/multihop/summary/compare）产出，历史在 Skill 层被吞掉 → 每轮都像第一次问 → 答非所问。直答/合成路径反而正常。

修复（两层）：
1. `SkillExecutor` 注入 `ctx.history`（置于 system 与当前 user 之间）；`QueryAgent` 同时把 `options.attachments` 透传给 SkillContext。前端历史固定取最近 10 轮（20 条），并对历史中带附件的 user 消息重建增强内容。
2. 联调中发现仅「机械注入历史」不够：QA 等 Skill 的检索驱动流程会让 LLM 忽略历史泛泛而谈。故在 `SkillExecutor` 当存在历史/附件时追加 `SKILL_CONTEXT_USE_NOTE`，明确要求「先回顾历史、历史/上传资料优先于泛泛检索、检索仅作补充、始终紧扣当前问题」。

### ④ 会话内上传文档即时问答（新功能）

详见 `openspec/add/20260730-core-chat-attachment-qa.md`。要点：新增 `POST /api/chat/attachments`（即时解析 PDF/Word/文本，依赖 pdf-parse v2 + mammoth，含 pdfjs DOM 桩）；WS `/ws/query` 接收 `options.attachments` 注入本轮上下文；`ChatMessageMeta.attachments` 持久化，供多轮重建；前端接入回形针上传、附件 chip、用户消息气泡展示附件清单。

## 影响的文件/模块

| 文件/模块 | 变更类型 | 说明 |
|----------|---------|------|
| `status/src/codeFence.ts` | 新增 | 围栏代码块切分/重组共享工具 |
| `status/src/sanitizeAnswerContent.ts` | 重写 | 代码块感知的泄露清除层 |
| `status/src/normalizeCitationMarkers.ts` | 修改 | 引用整理改为代码块感知 |
| `status/src/MarkdownContent.tsx` | 修改 | `wrapCitationRefs` 代码块感知 + mermaid 解析失败自动修复重试 |
| `app/src/skills/executor.ts` | 修改 | 注入 `ctx.history` 与 `ctx.attachments`（修复答非所问核心 bug） |
| `app/src/skills/types.ts` | 修改 | `SkillContext.attachments`；prompt 约束（禁泄露/聚焦） |
| `app/src/agent/system-prompt.ts` | 修改 | 默认/主调度/自定义 prompt 加入回答纪律 |
| `app/src/agent/query-agent.ts` | 修改 | 直答/合成路径拼接附件上下文；Skill 上下文透传附件 |
| `app/src/agent/types.ts` | 修改 | `QueryOptions.attachments` |
| `app/src/parser/chat-attachment-parser.ts` | 新增 | Buffer 即时解析 + pdfjs DOM 桩 |
| `app/src/routes/chat.ts` | 修改 | `POST /attachments` |
| `app/src/ws/query.ts` | 修改 | query schema 接收 `attachments` |
| `app/src/db/schema/chat-session.ts` | 修改 | `ChatMessageMeta.attachments` |
| `app/package.json` | 修改 | 新增 pdf-parse、mammoth 依赖 |
| `status/src/api.ts` | 修改 | `uploadChatAttachment` + meta 类型 |
| `status/src/pages/Chat.tsx` | 修改 | 上传 UI、附件 chip、多轮上下文携带、消息持久化 |
| `status/src/index.css` | 修改 | 附件/回形针样式 |

## 相关设计文档

- [会话内上传文档即时问答](../add/20260730-core-chat-attachment-qa.md)

## 验证方式

- [x] 后端 `bun run typecheck` 通过
- [x] 前端 `bun run typecheck` 通过
- [x] 前端 `bun run build` 通过
- [x] 45 个单元测试通过（13 个失败均为需 live 服务的 E2E WS 测试，非本次回归）
- [x] 清理器/引用/mermaid 关键路径运行时验证通过（mermaid 内 `[1]` 不被污染；泄露项被清除；合法法律文本与 mermaid 不受损）
- [x] 真实联调（启动 PG/Redis/后端/前端）端到端验证：
  - ④ 解析：txt / docx / pdf 三类真实文件经 `POST /api/chat/attachments` 均成功提取文本（docx 路径联调中发现 mammoth 在 Bun 需 `{buffer}` 而非 `{arrayBuffer}`，已修复）
  - ④ 使用：带附件提问，LLM 正确引用附件内容（违约金千分之五、最高百分之二十、条款编号 KB-E2E-7731）
  - ③ 多轮：第二轮不重发附件、仅靠历史，LLM 正确回忆出历史中上传合同的「北京仲裁委员会」仲裁机构（经 Skill 路径，证明历史注入 + SKILL_CONTEXT_USE_NOTE 生效）
  - ① 渲染：浏览器实测 mermaid 流程图渲染为真实 SVG（viewBox 1009×1582、77 个图形元素、75 个文本元素、无 fallback）
  - ② 防泄露：浏览器实测渲染后回答文本对 tool_calls / search_knowledge / call_agent / 权限键值对 / [Agent] 日志 / 函数 JSON 全部为 false（clean）
  - ④ UI：回形针上传 → 附件 chip 出现（contract.docx×）→ 发送后 chip 清除、用户气泡展示附件清单

## 后续工作

- [ ] 真实 PDF/Word 文件联调（已用生成的最小合法 PDF/docx 验证；建议再用真实业务文档验证排版复杂件）
- [ ] 大文件（接近 20MB）解析耗时与内存观测，必要时改为流式/分页提取
- [ ] 联调偶发单轮「正在理解」长时间不返回（后端健康、同路径直连 WS 可正常返回，疑为模型推理延迟；非本次回归，建议观测）
