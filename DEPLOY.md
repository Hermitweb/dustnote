# DustNote 服务端部署指南

> 本文档随 `dustnote-server-v<version>.zip` 一同发布，适用于 v2.0.0 及以上版本的自托管场景：家庭服务器 / VPS / 内网 / 离线环境。

DustNote 服务端基于 **Fastify + SQLite**，单进程即可运行，无需额外数据库。部署包已包含全部依赖源码与 Docker 编排文件，可任选以下方式部署：

| 部署方式                        | 难度   | 推荐场景                     | 自动更新证书     |
| ------------------------------- | ------ | ---------------------------- | ---------------- |
| Docker Compose（HTTP）          | ⭐     | 本地 / 内网 / 反代已有 Nginx | ❌               |
| Docker Compose + Caddy（HTTPS） | ⭐⭐   | 公网 VPS / 自有域名          | ✅ Let's Encrypt |
| 手动部署（Node.js 20/22）       | ⭐⭐⭐ | 无 Docker 环境 / 嵌入式设备  | ❌               |

---

## 〇、一条命令安装部署（推荐）

无需先 clone 仓库、无需手动装 Docker、无需手改 `.env`，一条命令完成「从 GitHub 拉取部署包 → 解压 → 装 Docker → 生成随机 `JWT_SECRET` → 构建启动 → 健康检查 → 输出访问地址」。

**Linux（Ubuntu/Debian/CentOS/RHEL/Fedora 等）与 macOS：**

```bash
curl -fsSL https://raw.githubusercontent.com/Hermitweb/dustnote/dev/setup-and-fixes/deploy/install.sh | bash
curl -fsSL https://raw.githubusercontent.com/Hermitweb/dustnote/dev/setup-and-fixes/deploy/install.sh | bash -s -- --cn --domain notes.example.com
```

**Windows（PowerShell）：**

```powershell
powershell -ExecutionPolicy Bypass -Command "iwr -UseBasicParsing https://raw.githubusercontent.com/Hermitweb/dustnote/dev/setup-and-fixes/deploy/install.ps1 | iex"
```

> 指定版本：追加 `--version v2.5.10`（Linux/macOS）或 `-Version v2.5.10`（Windows）；默认自动获取 GitHub 最新 Release。

### 已有部署包 / 仓库：本地一键部署

若已解压部署包或已 clone 仓库，可直接运行（跳过拉取步骤）：

```bash
./deploy/deploy.sh                # HTTP 模式（默认 8080 端口）
./deploy/deploy.sh --cn           # 中国网络（aliyun apk + npmmirror + docker 镜像加速）
./deploy/deploy.sh --domain notes.example.com   # 公网 HTTPS（Caddy 自动证书）
```

```powershell
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Cn
```

脚本生成的 `.env` 会自动写入随机 `JWT_SECRET`（64 字符 hex），无需手动设置。已存在 `.env` 时会跳过生成，避免覆盖旧配置。

---

## 一、目录结构

部署包 `dustnote-server-v<version>.zip` 解压后结构：

```
dustnote-server-v<version>/
├── server/                  # 服务端源码（Fastify + better-sqlite3）
│   ├── src/
│   ├── Dockerfile           # 容器构建文件
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── shared/                  # 共享类型与工具（构建时需要）
├── client-core/             # 客户端核心库（web 构建时需要）
├── web/                     # Web 前端源码（一体化 Dockerfile 构建时需要）
├── deploy/                  # 反代/部署辅助配置与一键脚本
│   ├── install.sh           # Linux/macOS 一条命令入口（拉取 + 部署）
│   ├── install.ps1          # Windows 一条命令入口（拉取 + 部署）
│   ├── deploy.sh            # Linux/macOS 部署执行（装 Docker + compose）
│   ├── deploy.ps1           # Windows 部署执行
│   ├── nginx.conf
│   ├── Caddyfile
│   ├── supervisord.conf
│   └── README.md
├── docker-compose.yml       # 容器编排（顶层）
├── Dockerfile               # 顶层构建文件（web + nginx + API 一体化）
├── .env.example             # 环境变量模板
├── .dockerignore
├── .npmrc                   # pnpm 配置（构建时需要）
├── package.json             # workspace 根 package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── DEPLOY.md                # 本文档
└── VERSION                  # 版本元信息
```

---

## 二、环境准备

### 系统要求

- **CPU 架构**：x86_64 / arm64（树莓派 4/5、Apple Silicon 均可）
- **内存**：≥ 512 MB（推荐 1 GB）
- **磁盘**：≥ 1 GB（含数据增长空间；SQLite 单库通常 < 100 MB）
- **操作系统**：Linux（推荐 Ubuntu 22.04+ / Debian 12+）/ macOS / Windows Server

### 软件依赖

| 方式           | 依赖                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Docker Compose | Docker 24+，Docker Compose v2+                                                                                                           |
| 手动部署       | Node.js 20/22/24（better-sqlite3 12.x 原生支持 Node 24），pnpm 9+，构建工具链（`python3` / `make` / `g++` 用于 better-sqlite3 原生编译） |

---

## 三、方式一：Docker Compose 部署（推荐）

### 3.1 快速启动（HTTP，本地/内网）

适合本地试用或内网部署。

```bash
# 1. 解压部署包
unzip dustnote-server-v<version>.zip
cd dustnote-server-v<version>

# 2. 复制环境变量配置（务必修改 JWT_SECRET！）
cp .env.example .env
vi .env

# 3. 构建并启动
docker compose up -d --build

# 4. 查看启动日志
docker compose logs -f dustnote

# 5. 验证健康检查
curl http://localhost:8080/api/v1/health
```

浏览器访问 `http://<服务器IP>:8080` 即可使用。

### 3.2 生产部署（HTTPS，公网 VPS）

使用 Caddy 自动申请 Let's Encrypt 证书。

```bash
# 1. 解压部署包
unzip dustnote-server-v<version>.zip
cd dustnote-server-v<version>

# 2. 配置环境变量
cp .env.example .env
cat >> .env <<EOF
DOMAIN=notes.your-domain.com
WEB_ORIGIN=https://notes.your-domain.com
JWT_SECRET=$(openssl rand -hex 32)
SERVER_VERSION=2.0.1
EOF

# 3. 启动（含 Caddy 反向代理）
docker compose --profile tls up -d --build

# 4. 查看 Caddy 证书申请日志
docker compose logs -f caddy
```

访问 `https://notes.your-domain.com` 即可。

> ⚠️ **前置条件**：
>
> - 域名 DNS 已 A 记录指向服务器公网 IP
> - 服务器 80 / 443 端口对公网开放（Let's Encrypt HTTP-01 校验需要）
> - 完成证书申请前请勿频繁重启，否则可能触发 Let's Encrypt 限频（每小时 5 次）

### 3.3 架构图

```
                ┌─────────────────────────────────┐
                │         Docker Host              │
                │                                   │
  :80/:443 ───► │  Caddy (TLS 模式)                 │
                │    ↓ reverse_proxy                │
                │  dustnote:3210                    │
                │    ↓                              │
  :8080 ──────► │  dustnote (HTTP 模式, 直连)       │
                │    ↓                              │
                │  dustnote-data (SQLite 卷)        │
                └─────────────────────────────────┘

- HTTP 模式：宿主机 :8080 → 容器 :3210
- TLS 模式：Caddy :80/:443 → dustnote:3210（自动 HTTPS）
```

### 3.4 常用运维命令

```bash
# 停止
docker compose down

# 重启
docker compose restart dustnote

# 查看服务状态
docker compose ps

# 查看健康检查结果
docker inspect --format='{{.State.Health.Status}}' dustnote

# 进入容器
docker compose exec dustnote sh

# 查看实时日志
docker compose logs -f dustnote

# 备份数据库
docker compose exec dustnote cp /app/server/data/dustnote.db /tmp/dustnote-backup.db
docker cp dustnote:/tmp/dustnote-backup.db ./dustnote-backup-$(date +%F).db

# 升级版本
unzip -o dustnote-server-vNEW.zip   # 解压新部署包覆盖
docker compose up -d --build

# 停止并删除数据卷（⚠️ 不可恢复）
docker compose down -v
```

---

## 四、方式二：手动部署（Node.js 20/22/24）

适用于无 Docker 或希望直接以 systemd 管理进程的场景。

> ℹ️ **Node 24 已支持**：better-sqlite3 已升级到 12.x，原生兼容 Node 24
> （v2.5.5+ 实测通过）。仅旧版 better-sqlite3 11.x 存在 Node 24 下
> `Statement::~Statement()` 断言崩溃问题——仍在运行旧版本的用户请升级，
> 或降级 Node 到 22 LTS。

### 4.1 安装依赖

```bash
# Node.js 20/22/24（推荐用 nvm）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 22
nvm use 22

# pnpm 9+
corepack enable
corepack prepare pnpm@9.12.0 --activate

# better-sqlite3 原生编译依赖
sudo apt-get update
sudo apt-get install -y python3 make g++
```

### 4.2 构建

```bash
unzip dustnote-server-v<version>.zip
cd dustnote-server-v<version>

# 安装依赖（frozen-lockfile 保证版本一致性）
pnpm install --frozen-lockfile

# 构建 shared 与 server
pnpm --filter @dustnote/shared build
pnpm --filter @dustnote/server build

# 验证构建产物
ls -la server/dist/
```

### 4.3 配置环境变量

```bash
cp server/.env.example .env
vi .env
```

关键字段（详见 §五）：

```dotenv
NODE_ENV=production
PORT=3210
DB_PATH=./data/dustnote.db
WEB_ORIGIN=https://notes.your-domain.com
SERVER_VERSION=2.0.1
JWT_SECRET=<openssl rand -hex 32 生成的 64 字符随机串>
LOG_LEVEL=info
```

### 4.4 启动（前台）

```bash
NODE_ENV=production node server/dist/index.js
```

### 4.5 使用 systemd 守护进程（推荐）

部署包内已附带 `deploy/supervisord.conf`，但生产环境推荐用 systemd：

```bash
# 1. 创建系统用户
sudo useradd -r -s /usr/sbin/nologin -d /opt/dustnote dustnote

# 2. 移动部署文件
sudo mkdir -p /opt/dustnote
sudo mv ./* /opt/dustnote/
sudo chown -R dustnote:dustnote /opt/dustnote

# 3. 创建数据目录
sudo -u dustnote mkdir -p /opt/dustnote/server/data

# 4. 写入 systemd unit
sudo tee /etc/systemd/system/dustnote.service <<'EOF'
[Unit]
Description=DustNote Server
After=network.target

[Service]
Type=simple
User=dustnote
WorkingDirectory=/opt/dustnote/server
EnvironmentFile=/opt/dustnote/.env
ExecStart=/usr/bin/node /opt/dustnote/server/dist/index.js
Restart=on-failure
RestartSec=5s
# 资源限制
LimitNOFILE=65535
MemoryMax=1G

# 安全沙箱
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/dustnote/server/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# 5. 启动
sudo systemctl daemon-reload
sudo systemctl enable --now dustnote
sudo systemctl status dustnote
sudo journalctl -u dustnote -f
```

---

## 五、环境变量说明

所有变量在 `.env`（Docker Compose / 手动启动均可读取），或在 systemd `EnvironmentFile` 中定义。

| 变量                         | 默认值                         | 说明                                                                 |
| ---------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| `NODE_ENV`                   | `production`                   | 运行环境（`production` 关闭热重载与详细日志）                        |
| `PORT`                       | `3210`                         | 容器内监听端口；宿主机映射见 `docker-compose.yml` 中 `${PORT:-8080}` |
| `DB_PATH`                    | `/app/server/data/dustnote.db` | SQLite 数据库路径（容器内绝对路径）                                  |
| `WEB_ORIGIN`                 | `http://localhost`             | Web 前端 origin，用于 CORS 白名单（生产必须改为实际域名）            |
| `SERVER_VERSION`             | `2.0.0`                        | 服务端版本号（**与 package.json 一致**，客户端校验用）               |
| `JWT_SECRET`                 | `dev-secret-change-me`         | JWT 签名密钥（**生产必须修改**，建议 `openssl rand -hex 32`）        |
| `LOG_LEVEL`                  | `info`                         | 日志级别：`trace` / `debug` / `info` / `warn` / `error`              |
| `MIN_CLIENT_VERSION`         | `0.1.0`                        | 客户端最低支持版本（低于此版本将拒绝连接）                           |
| `RECOMMENDED_CLIENT_VERSION` | `0.1.0`                        | 推荐客户端版本（低于此版本将提示升级）                               |
| `FORCE_UPDATE_VERSION`       | （空）                         | 强制升级版本（设置后低于此版本的客户端必须升级才能使用）             |
| `EOL_DATE_FOR_V0`            | （空）                         | 旧 MAJOR 版本客户端 EOL 日期                                         |
| `DOMAIN`                     | `localhost`                    | 仅 TLS 模式：Caddy 反向代理域名                                      |

> ⚠️ **安全提示**：
>
> - `JWT_SECRET` 必须为 32+ 字符的随机串
> - `WEB_ORIGIN` 必须改为实际访问域名，否则可能被 CSRF 利用
> - 生产环境将 `LOG_LEVEL` 设为 `info` 或 `warn`，不要用 `trace` / `debug`（会记录敏感字段）

---

## 六、反向代理配置

### 6.1 Nginx 反向代理（已有 Nginx）

部署包内附带 `deploy/nginx.conf` 参考配置。若已有外部 Nginx，按以下示例修改：

```nginx
# /etc/nginx/conf.d/dustnote.conf

upstream dustnote_api {
    server 127.0.0.1:3210;
    keepalive 32;
}

server {
    listen 80;
    server_name notes.your-domain.com;

    # 静态前端（如使用 web-dist.zip 部署前端）
    root /var/www/dustnote-web;
    index index.html;

    # gzip 压缩
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 256;

    # API 反代
    location /api/ {
        proxy_pass http://dustnote_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持（实时同步推送）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;

        # 静态资源缓存
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }

    # 客户端最大上传体积（笔记含图片时调大）
    client_max_body_size 50m;
}
```

### 6.2 Caddy 反向代理（自动 HTTPS）

部署包内附 `deploy/Caddyfile`，由 `docker compose --profile tls` 启用。若使用外部 Caddy：

```caddyfile
# /etc/caddy/Caddyfile

notes.your-domain.com {
    reverse_proxy 127.0.0.1:3210 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    # gzip + zstd 压缩
    encode gzip zstd

    # 安全响应头
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }

    log {
        output stdout
        format json
    }
}
```

Caddy 启动后会自动申请 Let's Encrypt 证书并续期。

---

## 七、HTTPS 配置说明

### 7.1 推荐方式：Caddy 自动证书

参考 §三（3.2）。Caddy 在 80/443 端口启动后会：

1. 首次访问域名时通过 HTTP-01 challenge 申请证书
2. 证书存放在 `caddy-data` 卷中
3. 自动续期（到期前 30 天）

**前置条件**：

- 域名 A 记录已指向服务器公网 IP
- 服务器 80 / 443 端口开放
- 防火墙未拦截 Let's Encrypt 验证请求

### 7.2 手动 Nginx + Certbot

适合已有 Nginx 反代基础设施的场景：

```bash
# 1. 安装 certbot
sudo apt-get install -y certbot python3-certbot-nginx

# 2. 申请证书（Nginx 必须已启动且 80 端口已配置 server_name）
sudo certbot --nginx -d notes.your-domain.com

# 3. 自动续期（certbot 已自动写入 cron / systemd timer）
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

Certbot 会自动修改 `/etc/nginx/conf.d/dustnote.conf`，将 80 端口重定向到 443，并配置证书路径。

### 7.3 自签证书（仅内网测试）

```bash
# 生成自签证书
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem \
  -days 365 -nodes -subj "/CN=notes.internal" \
  -addext "subjectAltName=DNS:notes.internal"

# Nginx 配置
server {
    listen 443 ssl;
    server_name notes.internal;

    ssl_certificate     /etc/nginx/cert.pem;
    ssl_certificate_key /etc/nginx/key.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # ...其余反代配置同 §6.1
}
```

> 自签证书仅用于内网测试。生产环境请使用 Let's Encrypt 或商业证书。

### 7.4 启用 HTTPS 后的客户端配置

服务端启用 HTTPS 后，必须同步更新以下环境变量：

```dotenv
WEB_ORIGIN=https://notes.your-domain.com
```

否则：

- 浏览器会因 CORS 拒绝跨协议请求
- 客户端登录后无法持久化 Cookie（`Secure` 属性仅在 HTTPS 下生效）

---

## 八、健康检查与监控

### 8.1 健康检查端点

`GET /api/v1/health` 返回：

```json
{
  "ok": true,
  "uptime": 3600,
  "version": "2.0.1",
  "db": "ok",
  "notesCount": 42,
  "foldersCount": 3,
  "timestamp": "2026-07-26T08:00:00.000Z"
}
```

- `ok: true` —— 服务正常
- `db: "ok"` —— SQLite 可读写
- `notesCount` / `foldersCount` —— 当前数据规模

### 8.2 Docker 健康检查

`docker-compose.yml` 已配置：

```yaml
healthcheck:
  test: ['CMD', 'curl', '-f', 'http://localhost:3210/api/v1/health']
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 10s
```

每 30 秒检查一次，连续 3 次失败后标记 unhealthy。可使用：

```bash
docker inspect --format='{{.State.Health.Status}}' dustnote
# healthy / unhealthy / starting
```

### 8.3 外部监控（推荐 Uptime Kuma）

将 `https://notes.your-domain.com/api/v1/health` 加入 HTTP(s) 监控，关键字 `ok:true`。

---

## 九、备份与恢复

### 9.1 备份

```bash
# Docker 部署：通过容器备份（推荐）
docker compose exec dustnote sqlite3 /app/server/data/dustnote.db ".backup '/tmp/dustnote-backup.db'"
docker cp dustnote:/tmp/dustnote-backup.db ./dustnote-backup-$(date +%F).db

# 或直接备份卷文件（需先停服务）
docker compose stop dustnote
tar -czf dustnote-data-$(date +%F).tar.gz /var/lib/docker/volumes/dustnote-data/_data
docker compose start dustnote

# 手动部署：直接备份文件
sqlite3 /opt/dustnote/server/data/dustnote.db ".backup '/opt/backups/dustnote-$(date +%F).db'"
```

### 9.2 自动定时备份（cron）

```bash
# /etc/cron.d/dustnote-backup
0 3 * * * root docker compose -f /opt/dustnote/docker-compose.yml exec -T dustnote sqlite3 /app/server/data/dustnote.db ".backup '/tmp/backup.db'" && docker cp dustnote:/tmp/backup.db /opt/backups/dustnote-$(date +\%F).db && find /opt/backups -name 'dustnote-*.db' -mtime +30 -delete
```

### 9.3 恢复

```bash
# 停止服务
docker compose stop dustnote

# 替换数据库文件
docker cp ./dustnote-backup-2026-07-26.db dustnote:/app/server/data/dustnote.db

# 重启
docker compose start dustnote
```

---

## 十、升级

### 10.1 Docker 部署升级

```bash
# 1. 备份当前数据（详见 §九）
docker compose exec dustnote sqlite3 /app/server/data/dustnote.db ".backup '/tmp/backup.db'"
docker cp dustnote:/tmp/backup.db ./dustnote-backup-$(date +%F).db

# 2. 下载新部署包并解压（覆盖旧文件）
unzip -o dustnote-server-vNEW.zip
cd dustnote-server-vNEW

# 3. 复用旧 .env
cp ../dustnote-server-vOLD/.env .

# 4. 重建容器（数据卷 dustnote-data 保留）
docker compose up -d --build

# 5. 验证健康检查
curl http://localhost:8080/api/v1/health
```

### 10.2 手动部署升级

```bash
# 1. 停止服务
sudo systemctl stop dustnote

# 2. 备份数据
sqlite3 /opt/dustnote/server/data/dustnote.db ".backup '/opt/backups/dustnote-$(date +%F).db'"

# 3. 解压新部署包
unzip -o dustnote-server-vNEW.zip -d /opt/dustnote-new
cd /opt/dustnote-new

# 4. 复用旧 .env
cp /opt/dustnote/.env .

# 5. 重新构建
pnpm install --frozen-lockfile
pnpm --filter @dustnote/shared build
pnpm --filter @dustnote/server build

# 6. 切换目录软链
sudo ln -sfn /opt/dustnote-new /opt/dustnote

# 7. 启动服务
sudo systemctl start dustnote
sudo journalctl -u dustnote -f
```

> ⚠️ **跨主版本升级**（如 v1.x → v2.x）请先查看 [CHANGELOG](./CHANGELOG.md) 中的 BREAKING CHANGES，可能涉及数据库迁移。

---

## 十一、故障排查

### 11.1 容器启动失败

```bash
docker compose logs dustnote
```

常见原因：

| 错误                                              | 原因            | 解决方案                                                                                                |
| ------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| `EADDRINUSE: address already in use`              | 端口被占用      | 修改 `.env` 中的 `PORT`                                                                                 |
| `SQLITE_CANTOPEN`                                 | 数据卷权限问题  | `docker compose down && docker volume rm dustnote-data && docker compose up -d --build`（注意会丢数据） |
| `better-sqlite3 ... NODE_MODULE_VERSION mismatch` | Node ABI 不匹配 | 手动部署时重新 `pnpm rebuild better-sqlite3`                                                            |
| `ECONNREFUSED 127.0.0.1:3210`                     | 服务未启动      | `docker compose ps` 查看状态                                                                            |

### 11.2 数据库锁定

SQLite 在高并发下可能出现 `SQLITE_BUSY`。DustNote 默认启用 WAL 模式，单实例部署足够。

如确需多实例：

- 暂不支持（未来支持 PostgreSQL）
- 临时方案：在前端加 Nginx 负载均衡时使用 `ip_hash`，将同一用户的请求固定到同一实例

### 11.3 Caddy 证书申请失败

```bash
docker compose logs caddy
```

排查：

- 确认域名 DNS 已指向服务器公网 IP：`dig notes.your-domain.com +short`
- 确认 80/443 端口已开放：`curl -v http://notes.your-domain.com`
- 查看是否触发 Let's Encrypt 限频（每周 50 张/域名）
- 如使用 Cloudflare：将 DNS 设为"DNS only"（灰云），关闭 Proxy 直到证书申请成功

### 11.4 客户端无法连接

1. 检查 `WEB_ORIGIN` 是否匹配实际访问域名
2. 检查反向代理是否正确转发 `/api/` 前缀
3. 检查 `JWT_SECRET` 是否在升级后改变（改变后所有客户端需重新登录）

---

## 十二、安全加固清单

部署到公网前请逐项确认：

- [ ] `JWT_SECRET` 已改为 32+ 字符随机串（`openssl rand -hex 32`）
- [ ] `WEB_ORIGIN` 已改为实际域名
- [ ] `LOG_LEVEL` 设为 `info` 或 `warn`（避免记录敏感字段）
- [ ] 已启用 HTTPS（Caddy 自动 / Nginx + Certbot）
- [ ] 已配置防火墙（仅开放 80 / 443 / SSH 端口）
- [ ] 已配置定时数据库备份（§9.2）
- [ ] 已配置外部健康监控（§8.3）
- [ ] 已关闭服务器 SSH 密码登录（仅密钥）
- [ ] 已启用 Docker 容器只读根文件系统（可选，需调整数据卷挂载）

---

## 十三、相关资源

- [CHANGELOG](./CHANGELOG.md) —— 版本变更记录
- [SECURITY.md](./SECURITY.md) —— 安全策略与漏洞上报
- [CONTRIBUTING.md](./CONTRIBUTING.md) —— 贡献指南
- 服务端源码：`server/`
- 客户端发布页：https://github.com/Hermitweb/dustnote/releases

如有部署问题，请在 GitHub Issues 提交并附上：

- 部署方式（Docker / 手动）
- `docker compose logs` 或 `journalctl -u dustnote` 输出
- `cat .env`（**去除 JWT_SECRET 后**）
