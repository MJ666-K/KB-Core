# 变更日志：初始化文档体系 + 入库法律数据 + citations 修复

**日期**：2026-07-03
**项目缩写**：global
**类型**：功能新增 | Bug 修复

## 变更摘要

1. 初始化项目文档体系（PROJECT.md + openspec/），本次补充记录
2. 清空 smoke-test 数据，从 `data/` 入库 23 个真实法律文档
3. 修复 citations 在 Agent 直接调用 Tool 时返回空的 bug

## 变更详情

### 1. 文档体系（之前会话已做）
- 创建 `PROJECT.md` — 项目入口
- 创建 `openspec/` 目录结构 + 各模板
- 更新 `AGENTS.md` 补充 OpenSpec 工作流

### 2. 法律文档入库
- 清空数据库（删除所有 smoke-test 数据）
- 入库 23 个法律文档到 `legal` dataset（劳动合同法、民法典、公司法等）
- 生成 1089 chunks（895 child + 194 parent）
- 新增 `tests/ingest-data.ts` 批量入库脚本

### 3. Citations Bug 修复
**根因**：`query-agent.ts:resolveFinalAnswer()` 在 `direct` 和 `synthesis` 终止路径硬编码 `citations: []`。当 Agent 直接调用 `search_knowledge` Tool（不通过 Skill）时，检索结果被 JSON 化丢弃，未转为 Citation。

**修复**：
- 新增 `directRetrievalResults` 数组，收集 Agent 直接调 Tool 的 RetrievalResult
- 传给 `resolveFinalAnswer`，在 fallback 路径生成 citations
- 新增 `isRetrievalResult()` 类型守卫方法

### 4. CLI Chat 界面
- 新增 `tests/chat.ts` — 交互式 CLI 问答客户端
- 支持：spinner 等待、ANSI 着色、多轮历史（最多 10 轮）、`/clear`/`/quit`/`/help`/`/steps` 命令
- 通过 `KB_DATASET_ID` env 变量指定 dataset
- 在 package.json 加 `"chat"` script

## 影响的文件/模块

| 文件/模块 | 变更类型 | 说明 |
|----------|---------|------|
| `src/agent/query-agent.ts` | 修改 | 修复 citations 在 direct/synthesis 路径为空 |
| `tests/chat.ts` | 新增 | 交互式 CLI chat 客户端 |
| `tests/quick-check.ts` | 新增 | 临时测试脚本（可删） |
| `tests/test-retrieval.ts` | 新增 | 临时测试脚本（可删） |
| `tests/ingest-data.ts` | 新增 | 批量入库脚本 |
| `package.json` | 修改 | 加 `"chat"` script |
| `.env` | 修改 | 加 `KB_DATASET_ID` |

## 相关设计文档

无（Bug 修复 + 工具添加，不涉及新功能设计）

## 验证方式

- [x] `bun run typecheck` — 0 errors
- [x] `bun test` — 26/26 pass（单元测试）
- [x] 实测 citations 修复：`📎 Citations: 6`（修复前为 0）
- [x] 23 个法律文档全部就绪（status = ready）
- [x] 1089 chunks（895 child 嵌入 + 194 parent）

## 后续工作

- [ ] 清理临时测试文件（tests/quick-check.ts, tests/test-retrieval.ts, tests/try-query.ts）
- [ ] 写 changelog 文档（本次）
- [ ] E2E 测试 `BUN_TEST_INTEGRATION=true bun test tests/e2e-legal.test.ts`
