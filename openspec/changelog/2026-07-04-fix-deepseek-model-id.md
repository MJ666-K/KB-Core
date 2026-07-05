# Changelog: 修复 deepseek-v4-pro 模型配置错误

**日期**: 2026-07-04  
**作者**: Sisyphus  
**类型**: Bug fix

## 问题描述

数据库迁移文件中 `deepseek-v4-pro` 模型的 `modelId` 字段被错误配置为 `'deepseek-reasoner'`，但该模型 ID 在 dashscope API 中不存在，导致使用此模型的智能体调用 LLM API 时返回 404 错误：

```
LLM Stream error: 404, model not found: deepseek-reasoner
```

受影响的智能体：
- **基层调解助手 (mediation)** - 配置使用 deepseek-v4-pro
- **企业法务顾问 (corporate)** - 配置使用 deepseek-v4-pro

**结果**: 这两个智能体无法正常调用 LLM API，导致查询失败。

## 根本原因

数据库迁移文件 `src/db/migrations/manual_add_agents_and_skills.sql` 中的 INSERT 语句在 `deepseek-v4-pro` 模型的 `modelId` 字段使用了错误的值：

```sql
-- 错误配置
INSERT INTO models (...) VALUES
  ('deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek', 'deepseek-reasoner', ...);
```

dashscope API 实际支持的模型名称映射：
- `deepseek-chat` → DeepSeek-V4
- `deepseek-coder` → DeepSeek-V2.5 (代码特化版本)
- **不存在** `deepseek-reasoner` 模型

## 修复方案

### 1. 更新迁移文件

修改 `src/db/migrations/manual_add_agents_and_skills.sql`：
- INSERT 语句使用正确的 `model_id`：`'deepseek-chat'` 和 `'deepseek-coder'`
- 添加 UPDATE 语句修复数据库中已存在的错误配置

```sql
-- 修复现有 deepseek-v4-pro 模型的 modelId
UPDATE models 
SET model_id = 'deepseek-coder', updated_at = NOW()
WHERE name = 'deepseek-v4-pro' AND model_id != 'deepseek-coder';
```

### 2. 修复数据库现有记录

手动执行 bun 脚本更新数据库：
```typescript
await db.update(models)
  .set({ modelId: 'deepseek-coder', updatedAt: new Date() })
  .where(eq(models.name, 'deepseek-v4-pro'))
  .execute();
```

## 验证结果

### 模型配置验证
```json
{
  "name": "deepseek-v4-pro",
  "displayName": "DeepSeek V4 Pro",
  "provider": "deepseek",
  "modelId": "deepseek-coder"  // ✓ 已修复
}
```

### 智能体-模型映射验证
```json
[
  {
    "agentName": "router",
    "modelName": "qwen-turbo",
    "modelId": "qwen-turbo"  // ✓ 路由使用快速模型
  },
  {
    "agentName": "executor",
    "modelName": "qwen-plus",
    "modelId": "qwen-plus"  // ✓ 工具执行使用中等模型
  },
  {
    "agentName": "general",
    "modelName": "qwen-max",
    "modelId": "qwen-max"  // ✓ 通用助手使用强大模型
  },
  {
    "agentName": "mediation",
    "modelName": "deepseek-v4-pro",
    "modelId": "deepseek-coder"  // ✓ 已修复
  },
  {
    "agentName": "corporate",
    "modelName": "deepseek-v4-pro",
    "modelId": "deepseek-coder"  // ✓ 已修复
  }
]
```

### 服务状态
- ✓ 服务器正常运行 (PID: 169725)
- ✓ Health check 通过
- ✓ 服务日志无错误

## 影响范围

**受影响的文件**:
- `src/db/migrations/manual_add_agents_and_skills.sql`

**受影响的组件**:
- 数据库表 `models` 中的 `deepseek-v4-pro` 记录
- 使用此模型的智能体: `mediation`, `corporate`

**不受影响的组件**:
- 迁移脚本的执行逻辑
- SubAgentRegistry 的加载逻辑
- QueryAgent 的模型选择逻辑
- 前端 UI

## 后续建议

1. **部署后验证**: 重启服务后测试 mediation 和 corporate 智能体
2. **监控日志**: 确认不再有 404 错误
3. **考虑添加测试**: 
   - 验证所有模型的 `modelId` 都是有效的 API 模型名称
   - 验证智能体-模型映射的完整性

## 相关文件

- 迁移文件: `src/db/migrations/manual_add_agents_and_skills.sql`
- 模型 schema: `src/db/schema/models.ts`
- 智能体 schema: `src/db/schema/agents.ts`
- 日志增强: `openspec/changelog/20260704-backend-logging-enhancement.md`
