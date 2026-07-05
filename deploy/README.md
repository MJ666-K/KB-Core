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
| PostgreSQL | Docker 卷 `kc_pgdata` | 不再挂载 `./db`，避免权限 700 问题 |
| Redis | Docker 卷 `kc_redisdata` | 不再挂载 `./redis` |
| 上传文档 | `./app/documents` | 宿主机目录，方便备份 |
| 运行时配置 | `./app/data` | settings.json 等 |

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
