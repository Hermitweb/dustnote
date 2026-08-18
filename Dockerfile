# DustNote 生产 Docker 部署（一体化：web 静态 + nginx + API 单容器）
# docker compose up -d --build
#
# 此 Dockerfile 为一体部署，docker-compose.yml 默认使用本文件。
# server/Dockerfile 为「仅 API」镜像，仅在需要拆分部署时使用。

# ─── Stage 1: 全量构建 ───
FROM node:22-alpine AS builder
# 镜像源（中国网络通过 --cn 传入 Aliyun/npmmirror，国外保持官方源）
ARG APK_MIRROR=dl-cdn.alpinelinux.org
ARG NPM_REGISTRY=
RUN if [ "$APK_MIRROR" != "dl-cdn.alpinelinux.org" ]; then \
      sed -i "s|dl-cdn.alpinelinux.org|${APK_MIRROR}|g" /etc/apk/repositories; \
    fi
WORKDIR /app
RUN npm install -g pnpm@9.12.0

# better-sqlite3 在 musl 上没有预编译包，必须源码编译
RUN apk add --no-cache python3 make g++

# 安装依赖（patches/ 必须先于 install，package.json 里有 patchedDependencies）
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY patches patches
COPY shared/package.json shared/tsconfig.json shared/
COPY server/package.json server/tsconfig.json server/
COPY web/package.json web/tsconfig.json web/tsconfig.app.json web/tsconfig.node.json web/vite.config.ts web/tailwind.config.js web/postcss.config.js web/index.html web/
RUN if [ -n "$NPM_REGISTRY" ]; then pnpm config set registry "$NPM_REGISTRY"; fi \
  && pnpm install --frozen-lockfile

# 构建
COPY shared/src shared/src
COPY server/src server/src
COPY web/src web/src
COPY web/public web/public
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

# §3.9/§15：应用进程以非 root 运行（supervisord 保持 root 以绑定 80 端口，
# 但 server 子进程降权为 dustnote，数据目录归其所有，避免以 root 写库）
RUN adduser -D -h /app dustnote && chown -R dustnote:dustnote /app/server
RUN chmod 700 /app/server/data 2>/dev/null || true

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
