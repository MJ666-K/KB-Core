# syntax=docker/dockerfile:1

# ── Stage 1: 前端构建 ──
FROM node:20-alpine AS frontend
WORKDIR /src/status
COPY status/package.json status/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY status/ ./
RUN npm run build

# ── Stage 2: 后端运行 ──
FROM oven/bun:1.2-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache tini

COPY app/package.json app/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY app/ ./
COPY --from=frontend /src/status/dist /status/dist

RUN mkdir -p documents data

ENV NODE_ENV=production
ENV STATIC_ROOT=/status/dist
ENV APP_PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["bun", "src/index.ts"]
