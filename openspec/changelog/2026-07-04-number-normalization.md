# 2026-07-04 数字搜索规范化功能修复

## 变更摘要
修复了中文数字（如"第三十九条"）和阿拉伯数字（如"第39条"）搜索不匹配的问题。

## 问题描述
之前当用户查询"劳动合同法第39条"时，虽然 search_knowledge 工具能够找到相关法条，但由于数字格式不一致（用户输入"39"但法条中使用"三十九"），导致引用匹配不够准确。

## 解决方案
在 search-knowledge.ts 中实现了 bidirectional number normalization：
- 将阿拉伯数字转换为中文数字（39 → 三十九）
- 将中文数字转换为阿拉伯数字（三十九 → 39）
- 同时查询两种格式，确保匹配准确

## 修改文件
- `src/tools/search-knowledge.ts`
  - 添加 `normalizeQuery()` 函数
  - 实现 `chineseToArabic()` 转换函数
  - 实现 `ArabicToChinese()` 转换函数
  - 在查询执行时进行双向规范化

## 测试结果
测试查询："劳动合同法第39条规定了什么内容"
- ✅ Agent 正确调用 qa skill
- ✅ qa skill 调用 search_knowledge 找到第三十九条
- ✅ 返回准确引用（5个citations）
- ✅ 响应时间：24.4秒

## 验证
```bash
bun run typecheck  # 通过
bun tests/chat.ts  # 测试查询成功
```
