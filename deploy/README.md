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
| Neo4j | Docker 卷 `kc_neo4jdata` | 知识图谱节点与关系 |
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
- Neo4j Browser：http://localhost:7474（用户 `neo4j`，密码见 `.env` 中 `NEO4J_PASSWORD`）

## 知识图谱 / Neo4j

`KG_ENABLED=true` 时，应用通过 `bolt://neo4j:7687` 连接 Neo4j（compose 内自动配置，**不要用 localhost**）。

首次启动 Neo4j 会下载 APOC 插件，可能需要 **1～2 分钟**。`app` 会等 Neo4j 健康检查通过后再启动。

### 常见错误 `dependency failed to start: kc-neo4j is unhealthy`

按顺序排查：

```bash
# 1. 看 Neo4j 是否在反复重启
docker compose ps
docker compose logs neo4j --tail 100

# 2. 首次启动要下载 APOC，等 2～3 分钟再 ps 一次
```

| 日志关键词 | 原因 | 处理 |
|-----------|------|------|
| `OutOfMemoryError` / `Killed` | 内存不足 | `.env` 加 `NEO4J_HEAP_MAX=256m`、`NEO4J_PAGECACHE=128m` 后重启 |
| `Failed to download` / `plugin` | 无法下载 APOC | 检查服务器出网，或暂时注释 compose 里 `NEO4J_PLUGINS` 行测试能否启动 |
| `Unauthorized` / `authentication` | 数据卷里已是旧密码 | 重置 Neo4j 卷（会清空图谱）：`./deploy.sh neo4j-reset` 后再 `up` |

重置后密码以 `.env` 中 `NEO4J_PASSWORD` 为准（须与首次初始化一致，默认 `neo4j_dev_password`）。

### 常见错误 `ECONNREFUSED ... :7687`

1. **Neo4j 还没起来**：`docker compose ps` 看 `kc-neo4j` 是否为 `healthy`
2. **只重启了 app**：`./deploy.sh restart` 会等待 Neo4j；若 Neo4j 挂了需 `docker compose up -d neo4j`
3. **看 Neo4j 日志**：`./deploy.sh logs-neo4j` 或 `docker compose logs neo4j --tail 50`
4. **密码不一致**：`.env` 里 `NEO4J_PASSWORD` 须与 compose 中 `NEO4J_AUTH` 一致（默认 `neo4j_dev_password`）

### 导入图谱数据（可选）

```bash
docker exec kc-app bun run src/kg/ingest.ts /app/data/kg-data.json
```

（需先把 `kg-data.json` 放到 `deploy/data/`）
