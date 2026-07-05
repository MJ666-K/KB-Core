# Changelog - 模型表系统

**日期**：2026-07-04
**项目缩写**：core
**类型**：功能新增 | 架构改动

## 变更摘要

创建独立的 `models` 表存储模型配置，通过 ID 外键关联到 `agents` 表，实现模型参数的动态管理和子智能体级别的参数覆盖。

## 变更详情

### 1. 数据库层

**新增 `models` 表** (`src/db/schema/models.ts`)：
- 存储模型基本信息和推理参数
- 字段：id, name, displayName, provider, modelId, apiUrl, apiKey
- 模型参数：temperature, maxTokens, topK, topP, frequencyPenalty, presencePenalty

**修改 `agents` 表** (`src/db/schema/agents.ts`)：
- 移除 `model` TEXT 字段
- 新增 `modelId` UUID 外键关联到 models 表

**数据迁移** (`src/db/migrations/manual_add_agents_and_skills.sql`)：
- 创建 models 表并插入 5 个预设模型
- 迁移现有 agents 的 model TEXT 字段到 modelId FK

**预设模型配置**：
| 模型 | Provider | Temperature | MaxTokens | 用途 |
|------|----------|-------------|-----------|------|
| qwen-turbo | qwen | 0.1 | 512 | 快速路由决策 |
| qwen-plus | qwen | 0.2 | 2048 | 工具执行、文本整理 |
| qwen-max | qwen | 0.3 | 4096 | 通用推理 |
| deepseek-v4 | deepseek | 0.2 | 4096 | 复杂推理 |
| deepseek-v4-pro | deepseek | 0.3 | 8192 | 深度分析（劳动法、公司法） |

### 2. 后端服务层

**LLMService** (`src/llm/llm-service.ts`)：
- ChatOptions 扩展：topK, topP, frequencyPenalty, presencePenalty
- 支持 model.apiKey / model.apiUrl 覆盖全局配置
- chat() 和 chatStream() 均传递完整模型参数

**SubAgentRegistry** (`src/agent/sub-agent-registry.ts`)：
- 新增 `ModelConfig` 接口
- `AgentMetadata.model` 改为 `ModelConfig` 对象（包含完整配置）
- `loadFromDb()` 改为 JOIN models 表，一次性加载所有配置

**QueryAgent** (`src/agent/query-agent.ts`)：
- 构造函数改为接收 `ModelConfig` 对象
- 新增 `buildModelChatOptions()` 方法
- 调用 LLM 时传递模型配置参数

**Factory** (`src/index.ts`)：
- `createAgent()` 工厂方法传递 `meta.model` 给 QueryAgent

### 3. API 层

**Models API** (`src/routes/models.ts`)：
- `GET /api/models` - 列出所有模型（可选 ?enabled=true）
- `GET /api/models/:key` - 按 name 或 id 获取模型详情
- `POST /api/models` - 创建模型（支持完整参数验证）
- `PUT /api/models/:key` - 更新模型
- `DELETE /api/models/:key` - 删除模型

**Agents API** (`src/routes/agents.ts`)：
- `GET /api/agents` - 返回 agents 列表，JOIN 模型信息
- `GET /api/agents/:key` - 返回 agent 详情，JOIN 模型信息
- `POST /api/agents` - 创建 agent，使用 modelId UUID
- `PUT /api/agents/:key` - 更新 agent，使用 modelId UUID

### 4. 前端层

**Models 页面** (`status/js/pages/models.js`)：
- 新增模型管理页面
- 表格展示：名称、显示名、提供商、modelId、参数、状态
- 编辑弹窗：支持所有模型参数的编辑
- 侧边栏集成（🧠 图标）

**Agents 页面** (`status/js/pages/agents.js`)：
- 表格列 "模型" 改为显示 model.displayName
- 编辑弹窗动态加载 `/api/models` 列表
- 下拉选择：显示模型名称 + 配置摘要（T:M 等）
- 提交时使用 modelId UUID

### 5. 子智能体事件流显示

**前端聊天页面** (`tests/chat.ts`, `src/ws/query.ts`)：
- 子智能体徽章持久显示：`📡 [基层调解助手]`
- 同一工具多次调用合并：`→ ✅ search_knowledge ×3`
- 思考阶段缩进展示
- 修复 stdin 关闭错误

## 验证

### API 测试
- ✅ `GET /api/models` 返回 5 个模型配置
- ✅ `GET /api/agents` 返回 5 个智能体，含模型信息
- ✅ `POST /api/agents` 使用 modelId UUID 创建成功
- ✅ `PUT /api/agents/:name` 使用 modelId UUID 更新成功

### 端到端测试
- ✅ 简单问题（`你好`）：chat skill，11秒响应
- ✅ 劳动法问题（`试用期辞退`）：路由到 `基层调解助手` (deepseek-v4-pro)，3 次 search_knowledge
- ✅ 复杂问题（`股权架构`）：路由到 `企业法务顾问` (deepseek-v4-pro)，16 条引用，111秒（含多次重试）

### UI 测试
- ✅ `/models` 页面：列表、创建、编辑功能正常
- ✅ `/agents` 编辑：动态加载模型列表、选择后保存成功
- ✅ Chat 页面：工具合并显示 `×N`、子智能体徽章持久

## 性能观察

- `deepseek-v4-pro` 延迟较高（111秒对于复杂查询），但引用质量高
- 子智能体降级到 `通用法律助手` 时响应更快（约 50 秒）
- 工具调用合并显示显著减少 UI 干扰

## 后续工作

- [ ] (可选) 为每个模型添加"响应超时"配置，允许自动降级
- [ ] (可选) 添加模型性能监控，记录每次调用的延迟和 token 数
- [ ] (可选) 在 `/api/reload` 时重新加载模型配置，确保模型参数更新立即生效
