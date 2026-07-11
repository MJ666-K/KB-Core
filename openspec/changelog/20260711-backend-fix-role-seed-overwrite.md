# 修复启动时覆盖用户角色配置

**日期**: 2026-07-11  
**范围**: backend

## 问题

应用每次启动执行 `seedPresetRoles()` 时，会对已存在的内置角色（superadmin/admin/user）：

- 覆盖名称、描述
- 重新插入预设权限（用户删掉的权限会被加回来）

导致在 status 访问控制里修改的角色权限，重启后看起来「丢失」。

## 修复

`seedPresetRoles()` 改为仅当角色不存在时创建；已存在角色不再更新。

## 数据说明

- 角色/用户：PostgreSQL 卷 `kc_pgdata` 持久化
- 参数配置：宿主机 `deploy/data/settings.json`
- `docker compose down -v` 会删除卷，数据会清空
