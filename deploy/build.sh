#!/usr/bin/env bash
# 仅打包镜像，不启动服务
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKERFILE="$DEPLOY_DIR/Dockerfile"
DOCKERIGNORE="$DEPLOY_DIR/.dockerignore"

# 用法:
#   ./build.sh              → kb-core:latest
#   ./build.sh v1.0.0       → kb-core:v1.0.0
#   ./build.sh myrepo/kb-core:v1  → 完整镜像名
TAG_OR_IMAGE="${1:-latest}"

if [[ "$TAG_OR_IMAGE" == */* ]]; then
  IMAGE="$TAG_OR_IMAGE"
elif [[ "$TAG_OR_IMAGE" == *:* ]]; then
  IMAGE="$TAG_OR_IMAGE"
else
  IMAGE="kb-core:${TAG_OR_IMAGE}"
fi

# Dockerfile 需 COPY app/、status/，context 必须是仓库根目录。
# .dockerignore 只能放在 context 根目录才生效，构建前从 deploy/ 同步过去。
cp "$DOCKERIGNORE" "$ROOT/.dockerignore"

echo "🔨 构建镜像: $IMAGE"
echo "   context: $ROOT"
echo "   dockerfile: deploy/Dockerfile"
echo "   dockerignore: deploy/.dockerignore → 仓库根 .dockerignore"
echo ""

docker build -f "$DOCKERFILE" -t "$IMAGE" "$ROOT"

echo ""
echo "✅ 打包完成: $IMAGE"
echo ""
echo "下一步（部署）："
echo "  cd deploy"
echo "  cp .env.example .env   # 首次需配置"
echo "  KC_IMAGE=$IMAGE ./deploy.sh up"
echo ""
echo "导出离线包（可选）："
echo "  docker save $IMAGE -o kb-core.tar"
