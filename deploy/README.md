# KB-Core 部署

目录：`deploy/`

## 1. 打包

```bash
cd deploy
./build.sh v1.0.0
```

`.dockerignore` 维护在 `deploy/.dockerignore`，`build.sh` 会自动同步到仓库根再构建。

## 2. 部署

```bash
cd deploy
cp .env.example .env    # 首次
./deploy.sh up
```

## 数据持久化

| 存储 | 方式 | 说明 |
|------|------|------|
| PostgreSQL | Docker 卷 `kc_pgdata` | 用户、角色、权限、文档元数据等 |
| Redis | Docker 卷 `kc_redisdata` | 会话、队列等 |
| 上传文档 | `./data`（compose 挂载） | 宿主机目录，方便备份 |
| 运行时配置 | `./data/settings.json` | 参数配置页修改的检索/切割参数 |

**重启应用（`./deploy.sh restart`）不会丢失上述数据。** 以下操作会清空数据库：

- `docker compose down -v`（删除命名卷）
- 删除 Docker 卷 `deploy_kc_pgdata`

角色权限保存在 PostgreSQL，应用启动时只会**首次**写入内置角色（superadmin/admin/user），**不会**覆盖你已在界面上修改过的角色。

查看卷位置：`docker volume inspect deploy_kc_pgdata`

备份数据库：

```bash
docker exec kc-postgres pg_dump -U postgres knowledge_core > backup.sql
```

## 关于旧的 deploy/db

旧版 compose 把 Postgres 数据 bind mount 到 `./db`，容器内 postgres 用户会创建 **700 权限**目录，导致：

- 普通用户无法 `ls deploy/db`
- 旧版 Docker 构建扫描 context 时报 `can't stat deploy/db`（需 sudo 或 .dockerignore）

**现已改为命名卷。** 若本地还有残留目录可删除（数据已在卷里则勿删旧 db 前先备份）：

```bash
cd deploy
./deploy.sh down
sudo rm -rf db redis   # 仅清理旧 bind mount 残留
./deploy.sh up
```

## 访问

- 界面：http://localhost:3000
- 健康检查：http://localhost:3000/health
