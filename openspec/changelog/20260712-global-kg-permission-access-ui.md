# 知识图谱权限 + 访问控制界面优化

**日期**: 2026-07-12  
**范围**: backend, global

## 变更

### 知识图谱权限

- 新增 `kg:view` 权限，归入「基础功能」分组
- 前端菜单 `/kg`、路由守卫、后端 `/api/kg/*` 读接口均要求 `kg:view`
- `/api/kg/ingest` 额外要求 `settings:manage`
- 预设角色 `admin`、`user` 默认包含 `kg:view`

### 访问控制 UI

- 权限选择器支持搜索、进度条、权限说明与标识展示
- 权限分组使用稳定 `key`（basic/docs/config/admin），修复分组色条 CSS 不生效问题
- 角色列表展示权限数量摘要

## 注意

已存在的内置角色不会自动获得 `kg:view`，需在「访问控制 → 角色权限」中手动勾选，或由 superadmin 编辑后保存。

## 2026-07-12 补充修复（二）

- 移除 superadmin 硬编码「始终全部权限」；超级管理员与普角色一样按数据库配置生效
- superadmin 仅保留底线：`users:manage` + `roles:manage` 不可取消
- `ensurePresetRolePermissions` 不再自动给 superadmin 补权限（避免测试配置被重启覆盖）
