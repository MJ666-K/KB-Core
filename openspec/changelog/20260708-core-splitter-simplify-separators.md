# 变更日志：简化切分分隔符 + 去掉 chunk 标题前缀 + overlap 严格按句号

**日期**：2026-07-08
**项目缩写**：core
**类型**：功能改进 | 重构

## 变更摘要

将文本切分分隔符从三级法律结构正则（`第X编/章/节/条` → `（一）款项` → `。`句号）简化为两级通用分隔符（`\n`段落 → `。`句号），去掉 chunk.text 的法律结构标题前缀（如`"第一条 "`）使 chunk 为纯正文，并改造 overlap 逻辑使其起点严格落在句号边界而非按字数暴力切割。

## 变更详情

### 背景

原切分逻辑专为法律文档设计：L0 用正则匹配「第X编/章/节/条」作为主切分点，L1 匹配「（一）款项」，L2 才是句号。此外 `ParentChildSplitter` 给每个 chunk.text 前拼接 `StructureIndex.formatPrefix(meta)` 生成的标题前缀（如`"第一编 第二章 第三条 "`）。

用户反馈：切分逻辑过于法律专用，且 chunk 文本带标题前缀不符合预期。要求：
1. chunk.text 不加标题前缀
2. 优先按段落 `\n` 切割，其次句号
3. 不使用其他符号（分号/逗号/感叹号等）及空格

### 改动

1. **分隔符简化**（`separators.ts`）：`LEGAL_LEVELS` 从三级改为两级 `[['\n'], ['。']]`，删掉 `CN_NUM` 常量和两个法律结构正则。不再按「第X条」「（一）」切分。

2. **去掉标题前缀**（`parent-child-splitter.ts`）：删除 `parentPrefix`/`childPrefix` 的 `formatPrefix` 调用与拼接，`chunk.text`/`tokenCount`/`contentHash` 全部基于纯正文。`metadata.structure`（编/章/节/条元数据）保留——`StructureIndex` 独立扫描原文，不依赖分隔符，作为元数据供检索/展示使用，但不注入文本。

3. **overlap 严格按句号**（`recursive-splitter.ts`）：重写 `addOverlap`，删除原 `ratio`/`snapTolerance` 按 token 比例算 `startChar` 再容差 snap 的字数暴力逻辑。新增 `findOverlapStartByPeriod`：收集 prev 中所有句号位置，选 overlap 长度 ≤ overlapSize 且最大的（最靠前满足的句号）；若所有句号之后 overlap 都超标，取最后一个句号（overlap 偏大但守住句号边界）；若无句号，不 overlap。

### 设计决策

- **保留 `StructureIndex` + `metadata.structure`**：法律结构信息作为元数据仍有价值（检索时可按条过滤、前端可展示归属），且对非法律文档自动为 undefined 不污染。去掉它会让法律文档丢失有用的结构信息。
- **`formatPrefix` 方法保留**：虽然目前无调用方（dead method），但作为 `StructureIndex` 公开 static 方法保留，未删除（超出本次范围，避免过度改动）。
- **分隔符只用 `\n` 和 `。`**：符合用户"段落优先、句号其次、不用其他符号"的要求。`recursive-splitter.ts` 的 `splitAtPeriodBoundary`/`findPeriodCut` 仍用 `PERIOD` 做兜底（找不到句号不切，整块返回），行为已是句号边界，无需改动。

## 影响的文件/模块

| 文件/模块 | 变更类型 | 说明 |
|----------|---------|------|
| `app/src/splitter/separators.ts` | 修改 | `LEGAL_LEVELS` 改为 `[['\n'], ['。']]`，删 `CN_NUM` 和法律正则 |
| `app/src/splitter/parent-child-splitter.ts` | 修改 | 去掉 parent/child 的 prefix 拼接，chunk.text=纯正文 |
| `app/src/splitter/recursive-splitter.ts` | 修改 | 重写 `addOverlap` 严格按句号找起点，新增 `findOverlapStartByPeriod`，删 ratio/snapTolerance 字数暴力逻辑 |
| `app/tests/multi-level-splitter.test.ts` | 修改 | 删"L0误伤防护"测试(前提消失)、offset 断言 `toBeLessThan`→`toBe`、更新测试名 |
| `app/tests/parent-child-splitter.test.ts` | 修改 | offset 测试断言 `endsWith`→`toBe`、更新测试名 |

## 相关设计文档

无（切分逻辑改进，不涉及新功能设计）

## 验证方式

- [x] `bun run typecheck` — 0 errors（strict 模式）
- [x] `bun test tests/multi-level-splitter.test.ts tests/parent-child-splitter.test.ts tests/recursive-splitter.test.ts` — 16/16 pass
- [x] `bun test`（全量单元测试）— 45/45 pass
- [ ] E2E 测试（13 个失败，`Not authenticated`，预先存在，与本次改动无关）

## 后续工作

- [ ] 考虑清理 `StructureIndex.formatPrefix`（现 dead method，确认无外部调用后可删）
- [ ] 若已有数据库 chunk 含旧 prefix，重新入库可刷新为纯正文（非必须，旧 chunk 仍可用）
- [ ] 跑 E2E 测试验证检索/问答端到端正常（需启动服务 + 认证）
