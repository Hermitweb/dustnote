# DustNote 生产 Docker 部署
# docker compose up -d --build

# ─── Stage 1: 全量构建 ───
FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@9.12.0

# 安装依赖
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY shared/package.json shared/tsconfig.json shared/
COPY server/package.json server/tsconfig.json server/
COPY web/package.json web/tsconfig.json web/vite.config.ts web/tailwind.config.js web/postcss.config.js web/index.html web/
RUN pnpm install --frozen-lockfile

# 构建
COPY shared/src shared/src
COPY server/src server/src
COPY web/src web/src web/public web/public
RUN pnpm --filter @dustnote/shared build
RUN pnpm --filter @dustnote/server build
RUN pnpm --filter @dustnote/web build

# 生产依赖独立部署（flatten node_modules）
RUN pnpm --filter @dustnote/server deploy /prod-server

# ─── Stage 2: 运行 ───
FROM node:22-alpine
RUN apk add --no-cache nginx supervisor tini curl

# Server（pnpm deploy 已含 @dustnote/shared 依赖 + 编译产物）
COPY --from=builder /prod-server /app/server

# Web 静态
COPY --from=builder /app/web/dist /app/web-dist

# 创建数据目录
RUN mkdir -p /app/server/data

# 环境
ENV NODE_ENV=production PORT=3210
ENV DB_PATH=/app/server/data/dustnote.db
ENV WEB_ORIGIN=http://localhost

# nginx + supervisor
RUN mkdir -p /run/nginx
COPY deploy/nginx.conf /etc/nginx/http.d/default.conf
COPY deploy/supervisord.conf /etc/supervisord.conf

EXPOSE 80
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
