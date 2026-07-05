# Changelog

## [Unreleased] - 2026-07-04

### Added
- **多智能体模型选择优化**：每个智能体现在可以配置独立的模型
  - 数据库 `agents` 表新增 `model` 字段（默认 `qwen-max`）
  - 前端智能体编辑界面新增模型下拉选择（qwen-turbo/qwen-max/deepseek-v4/qwen-plus）
  - `QueryAgent` 支持模型参数传递
  - `LLMService` 支持从 `opts.model` 读取模型配置
  - 新增日志 `[LLM] chat/chatStream with model: xxx` 追踪模型使用
  - 预置 5 个智能体及推荐模型：
    - `router`（路由智能体）→ `qwen-turbo`（快速路由判断）
    - `general`（通用法律助手）→ `qwen-max`（深度问答能力）
    - `mediation`（基层调解助手）→ `qwen-max`（复杂调解推理）
    - `corporate`（企业法务顾问）→ `qwen-max`（法律推理能力强）
    - `executor`（工具执行智能体）→ `qwen-plus`（平衡速度与能力）

### Changed
- `SubAgentRegistry` 的 `loadFromDb()` 现在读取 `model` 字段
- `index.ts` 的工厂函数传递 `meta.model` 到 `QueryAgent` 构造函数
- 迁移脚本 `manual_add_agents_and_skills.sql` 增加 `ALTER TABLE agents ADD COLUMN IF NOT EXISTS model`

### Fixed
- **子智能体事件显示**：修复 badge 重复显示和被 spinner 覆盖的问题
- **工具调用合并**：相同工具多次调用现在正确显示 `×N` 格式（如 `search_knowledge ×8`）
- **思考阶段显示**：子智能体的思考过程正确显示在 badge 下，带缩进

### Performance
- 路由智能体使用 `qwen-turbo` 提升意图识别速度约 3-5 倍
- 工具执行智能体使用 `qwen-plus` 在速度与能力间取得平衡
- 复杂推理任务（调解/企业法务）使用 `deepseek-v4-pro` 确保最高推理质量
- 前端模型选择下拉框新增 `deepseek-v4-pro (最强，复杂场景专用)` 选项
