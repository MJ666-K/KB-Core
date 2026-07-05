# 2026-07-04 - 数字搜索规范化 + 后台管理系统

## 变更摘要
1. 修复了数字搜索问题：实现阿拉伯数字 ↔ 中文数字双向转换
2. 创建了完整的后台管理系统（Models、Agents、Skills 管理页面）
3. 配置了 5 个智能体使用不同的优化模型
4. 添加了前端 SPA 框架（6个页面：Home、Models、Agents、Skills、Documents、Chat）

## 详细变更

### 后端 (Backend)
#### 1. 数字搜索规范化 (`src/tools/search-knowledge.ts`)
- 实现 `normalizeQuery()` 函数：将 "第39条" ↔ "第三十九条" 双向转换
- 支持阿拉伯数字转中文（阿拉伯 → 中文）
- 支持中文转阿拉伯数字（中文 → 阿拉伯）
- 在每次搜索前自动规范化查询字符串，确保匹配准确性

#### 2. 数据库 Schema (`src/db/schema/`)
- 已存在：`models.ts`, `agents.ts`, `skill-definitions.ts`
- Models 表：管理 5 个预配置模型
- Agents 表：管理 5 个预配置智能体
- Skill Definitions 表：管理 6 个预配置技能

#### 3. 智能体模型配置
配置了 5 个智能体使用不同的优化模型：
- **Router Agent**: qwen-turbo (快速路由)
- **Executor Agent**: qwen-plus (执行调用)
- **General Agent**: qwen-max (通用对话)
- **Corporate Agent**: deepseek-v4-pro (企业法务)
- **Mediation Agent**: deepseek-v4-pro (调解仲裁)

### 前端 (Frontend - `/status/`)
创建了完整的 SPA 管理系统，包含 6 个页面：

#### 页面结构
- **index.html** - 基础 HTML 框架
- **css/style.css** - 简洁现代的样式（已存在）
- **js/app.js** - 应用主入口，路由管理
  - **pages/home.js** - 首页：系统状态概览
  - **pages/models.js** - 模型管理页面
  - **pages/agents.js** - 智能体管理页面
  - **pages/skills.js** - 技能管理页面
  - **pages/documents.js** - 文档管理页面
  - **pages/chat.js** - 聊天页面（流式响应）
  - **components/** - 可复用组件（table, modal, sidebar）

## API 端点验证

所有 API 端点工作正常：
```bash
curl http://localhost:3000/health  # ✅ 200 OK
curl http://localhost:3000/api/models     # ✅ 返回 5 个模型
curl http://localhost:3000/api/agents     # ✅ 返回 5 个智能体
curl http://localhost:3000/api/skills     # ✅ 返回 6 个技能
```

## 测试验证

### 后端
```bash
bun run typecheck  # ✅ 通过
bun test          # ✅ 全部通过
```

### 前端
访问：http://localhost:3000/
- ✅ Home 页面：显示系统状态
- ✅ Models 页面：列出 5 个模型，可编辑配置
- ✅ Agents 页面：列出 5 个智能体，可编辑配置
- ✅ Skills 页面：列出 6 个技能，可编辑配置
- ✅ Documents 页面：文档管理（上传、删除、重新切片）
- ✅ Chat 页面：实时交互式聊天，流式响应

## 使用说明

### 访问系统
1. 确保服务已运行：`bun run dev`
2. 打开浏览器访问：http://localhost:3000/
3. 使用左侧导航栏切换不同页面

### 管理模型
- 访问 /models 页面
- 点击编辑按钮可修改：
  - Model ID（API 请求时使用的模型标识）
  - API URL（自定义端点，留空使用全局配置）
  - API Key（自定义密钥，留空使用全局配置）

### 管理智能体
- 访问 /agents 页面
- 修改智能体配置：
  - System Prompt（系统提示词）
  - Model ID（智能体使用的模型）
  - Dataset IDs（智能体可访问的数据集）
  - Skill Names（智能体可使用的技能）

### 聊天功能
- 访问 /chat 页面
- 输入问题，系统会根据问题类型自动选择合适的智能体
- 系统支持流式响应，实时显示回答
- 可以查看智能体的思考过程和工具调用历史

## 配置示例

### 添加新模型
访问 /models 页面，点击 "添加模型"，填写：
```
Model ID: my-custom-model
Display Name: 自定义模型
API URL: https://my-api.com/v1
API Key: sk-your-key
Temperature: 0.7
```

### 创建新智能体
访问 /agents 页面，点击 "创建智能体"，填写：
```
Name: legal-expert
System Prompt: 你是一位专业的法律顾问...
Model ID: deepseek-v4-pro
Dataset IDs: legal
Skill Names: search,answer
```

## 待完成
- 前端：完善错误处理和用户反馈
- 前端：添加更多交互功能（如批量操作）
- 后端：优化数字搜索的准确性
- 文档：更新用户使用指南
