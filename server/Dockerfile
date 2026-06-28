# ========== 构建阶段 ==========
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# 先装依赖（缓存命中）
COPY package.json pnpm-workspace.yaml ./
COPY pnpm-lock.yaml* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile

# 复制源码
COPY tsconfig*.json ./
COPY shared shared
COPY server server
COPY web web

# 构建
RUN pnpm --filter @mintnote/shared build
RUN pnpm --filter @mintnote/server build

# ========== 运行阶段 ==========
FROM node:20-alpine AS runtime
RUN apk add --no-cache tini curl sqlite
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3210

# 复制必要产物
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/server/.env.example ./server/

# 非 root 运行
RUN addgroup -g 1001 -S nodejs && adduser -S dustnote -u 1001
RUN mkdir -p /app/data && chown -R dustnote:nodejs /app
USER dustnote
WORKDIR /app/server

EXPOSE 3210

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3210/api/v1/health || exit 1

# 优雅关闭
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
