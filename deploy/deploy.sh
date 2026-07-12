#!/usr/bin/env bash
# 仅部署/启停，不构建镜像（请先 ./build.sh）
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"

cd "$DEPLOY_DIR"

if [[ ! -f .env ]]; then
  echo "❌ 缺少 deploy/.env，请先："
  echo "   cp .env.example .env"
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

IMAGE="${KC_IMAGE:-kb-core:latest}"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "❌ 本地没有镜像: $IMAGE"
  echo "   请先打包: ./build.sh"
  echo "   或导入:   docker load -i kb-core.tar"
  exit 1
fi

CMD="${1:-up}"

case "$CMD" in
  up)
    echo "🚀 启动服务（镜像: $IMAGE）..."
    KC_IMAGE="$IMAGE" docker compose -f "$COMPOSE_FILE" up -d
    echo ""
    echo "✅ 部署完成"
    echo "   访问: http://localhost:${APP_PORT:-3000}"
    echo "   健康: http://localhost:${APP_PORT:-3000}/health"
    echo "   日志: ./deploy.sh logs"
    echo "   Neo4j: ./deploy.sh logs-neo4j"
    ;;
  down)
    docker compose -f "$COMPOSE_FILE" down
    ;;
  logs)
    docker compose -f "$COMPOSE_FILE" logs -f app
    ;;
  ps)
    docker compose -f "$COMPOSE_FILE" ps
    ;;
  restart)
    echo "🔄 重启应用..."
    KC_IMAGE="$IMAGE" docker compose -f "$COMPOSE_FILE" up -d --force-recreate app
    ;;
  logs-neo4j)
    docker compose -f "$COMPOSE_FILE" logs -f neo4j
    ;;
  neo4j-reset)
    echo "⚠️  将删除 Neo4j 数据卷（图谱数据会清空）"
    read -r -p "确认输入 yes: " confirm
    if [[ "$confirm" != "yes" ]]; then
      echo "已取消"
      exit 1
    fi
    docker compose -f "$COMPOSE_FILE" down
    docker volume ls -q | grep kc_neo4jdata | xargs -r docker volume rm
    echo "✅ Neo4j 卷已删除，请重新: ./deploy.sh up"
    ;;
  *)
    echo "用法: $0 {up|down|logs|logs-neo4j|ps|restart|neo4j-reset}"
    exit 1
    ;;
esac
