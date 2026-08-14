# DustNote 仅 API 的服务端镜像（不含 web 静态资源与 nginx）
# 需要「web + API 一体」的一键部署请用仓库根目录的 Dockerfile / docker-compose.yml
#
# 构建（必须在 monorepo 根目录执行，context 是根目录）：
#   docker build -f server/Dockerfile -t dustnote-server:2.1.0 .

# ========== 构建阶段 ==========
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# better-sqlite3 在 musl 上没有预编译包，必须源码编译
RUN apk add --no-cache python3 make g++

# 先装依赖（缓存命中）。patches/ 必须先于 install，package.json 里有 patchedDependencies
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY patches patches
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile

# 复制源码（根目录没有 tsconfig.json，各包自带）
COPY shared shared
COPY server server

# 构建
RUN pnpm --filter @dustnote/shared build
RUN pnpm --filter @dustnote/server build

# 产出自包含目录：pnpm deploy 会把 workspace 依赖（@dustnote/shared）和
# 生产依赖一起铺平进 /prod-server/node_modules，运行阶段无需 pnpm 布局
RUN pnpm --filter @dustnote/server --prod deploy /prod-server

# ========== 运行阶段 ==========
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini curl
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3210
ENV DB_PATH=/app/data/dustnote.db

# 复制必要产物
COPY --from=builder /prod-server ./

# 非 root 运行
RUN addgroup -g 1001 -S nodejs && adduser -S dustnote -u 1001 -G nodejs
RUN mkdir -p /app/data && chown -R dustnote:nodejs /app
USER dustnote

EXPOSE 3210

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3210/api/v1/health || exit 1

# 优雅关闭
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
