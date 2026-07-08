# 变更日志：全局 UI 主题样式优化

**日期**：2026-07-09
**项目缩写**：global
**类型**：功能改进

## 变更摘要

统一前端设计令牌与 Ant Design 主题，优化侧栏、顶栏、问答、登录及内容页视觉风格，形成更专业的法律知识库控制台观感。

## 变更详情

- 新增 CSS `:root` 设计变量（主色、背景、边框、圆角、阴影）
- 重写 `theme.ts`：主色 `#1a56db`、侧栏 `#0f172a`、页面背景 `#eef1f6`、统一圆角 8/12px
- 侧栏菜单圆角选中态、顶栏 60px、版本号胶囊样式
- 问答区卡片/会话列表/用户气泡与主题色对齐
- 登录页渐变与整体品牌色一致
- 控制台统计卡片 hover 微动效
- 参数配置页：页头与卡片分组布局、数字输入紧凑宽度、流水线配色对齐设计令牌
- 亮色 / 暗色主题切换：顶栏与登录页切换按钮，偏好持久化至 localStorage
- 暗色下图表适配：控制台统计卡、检索流水线、Mermaid 流程图与 Markdown 表格
- 暗色主题文字色全面适配：CSS 变量替换硬编码黑色、文档详情/聊天/上传/权限等页面
- 登录页动态背景：渐变光晕、浮动光球、知识网格与斜线纹理（支持亮/暗主题与减弱动效）

## 影响的文件/模块

| 文件/模块 | 变更类型 | 说明 |
|----------|---------|------|
| `status/src/theme.ts` | 修改 | Ant Design 主题 |
| `status/src/index.css` | 修改 | 设计令牌 + 布局/组件样式 |
| `status/src/App.tsx` | 修改 | 顶栏标题样式类 |
| `status/src/pages/Dashboard.tsx` | 修改 | 统计色板 |
| `status/src/pages/Settings.tsx` | 修改 | 参数配置布局与分组 |
| `status/src/theme.ts` | 修改 | `createAntdTheme` 亮/暗两套配置 |
| `status/src/theme/ThemeContext.tsx` | 新增 | 主题状态与 ConfigProvider |
| `status/src/components/ThemeToggle.tsx` | 新增 | 主题切换按钮 |
| `status/src/main.tsx` | 修改 | ThemeProvider 包裹 |
| `status/src/App.tsx` | 修改 | 顶栏主题切换 |
| `status/src/pages/Login.tsx` | 修改 | 登录页主题切换 |
| `status/index.html` | 修改 | 防闪烁脚本 |

## 验证方式

- [x] `bun run typecheck`（status/）通过
- [ ] 浏览控制台、文档库、法律助手、登录页确认视觉一致
