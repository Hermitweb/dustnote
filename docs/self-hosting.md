# 自托管指南

> 适用版本：v2.0.0 及以上
> 完整部署文档请参考 [DEPLOY.md](../DEPLOY.md)（v2.0.0 新增）

本指南帮助你在自己的服务器上部署 DustNote。

> **v2.0.0 双模式架构**：客户端可在「单机模式」下无服务器独立运行。部署服务器后，客户端选择「连接服务器」即可使用联机模式（跨设备同步、在线分享、设备管理等高级功能）。详见 `standalone-mode.md`（standalone-mode.md，早期设计稿未入库）。

## 1. 部署方式

| 方式           | 难度     | 适合             |
| -------------- | -------- | ---------------- |
| Docker Compose | ⭐       | 个人服务器 / VPS |
| 手动部署       | ⭐⭐⭐   | 自定义环境       |
| Kubernetes     | ⭐⭐⭐⭐ | 团队 / 集群      |

## 2. 系统要求

### 2.1 最低

- CPU：1 核
- 内存：1 GB
- 硬盘：10 GB
- 系统：Linux（Ubuntu 22.04 LTS / Debian 12 推荐）

### 2.2 推荐

- CPU：2 核
- 内存：2 GB
- 硬盘：20 GB SSD
- 系统：Ubuntu 22.04 LTS

## 3. Docker Compose 部署（推荐）

### 3.1 准备

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 安装 Docker Compose
sudo apt install docker-compose-plugin
```

### 3.2 创建部署目录

```bash
mkdir -p ~/dustnote && cd ~/dustnote
mkdir -p data/attachments backups
```

### 3.3 docker-compose.yml（仓库自带）

仓库根目录的 `docker-compose.yml` 走**一体化构建**——web 静态文件编译进镜像，与 server 同容器、同源、同一 3210 端口，无需独立 nginx；自带 `healthcheck`（构建产物内置 `/health` 探测端点）：

```yaml
services:
  dustnote:
    build: . # 从源码构建一体化镜像（web + server）
    image: dustnote/server
    container_name: dustnote
    restart: unless-stopped
    ports:
      - '8080:3210' # 宿主 8080 → 容器内 3210（web + API 同源）
    env_file: .env
    volumes:
      - ./data:/data
    read_only: false
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - DAC_OVERRIDE
    healthcheck:
      test: ['CMD', 'wget', '-q', '--spider', 'http://localhost:3210/api/v1/health']
      interval: 30s
      timeout: 5s
      retries: 3
```

> 启动：`docker compose up -d --build`，浏览器开 `http://<host>:8080/` 即见登录页；验证 `curl -fsS http://localhost:8080/api/v1/health`。
> 构建前先跑 digest pin（§8）。

### 3.4 .env

```bash
# 必填：JWT 签名密钥，至少 32 字符
JWT_SECRET=$(openssl rand -base64 48)

# 公网域名（同源部署时即你反代/暴露的 URL）
WEB_ORIGIN=https://note.example.com
```

### 3.5 可选：nginx 反代 + HTTPS（同源场景）

一体化部署后 web 与 API 已在同一容器内同源，**免跨域**。如需 HTTPS 终结与域名安全头，在容器前加一层 nginx 反代即可（`deploy/nginx.conf` 与 `deploy/Caddyfile` 提供两套示例）。最小 nginx 段（完整 CSP 版见 `deploy/nginx.conf`）：

```nginx
events {
    worker_connections 1024;
}

http {
    # 强制 HTTPS
    server {
        listen 80;
        server_name note.example.com;
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name note.example.com;

        # SSL
        ssl_certificate     /etc/nginx/certs/fullchain.pem;
        ssl_certificate_key /etc/nginx/certs/privkey.pem;
        ssl_protocols       TLSv1.3;
        ssl_ciphers         TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256;
        ssl_prefer_server_ciphers on;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

        # 安全头
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' wss://note.example.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests;" always;

        # 客户端最大上传
        client_max_body_size 60m;

        # API 代理
        location /api/ {
            proxy_pass http://dustnote:3210;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_http_version 1.1;

            # WebSocket 升级
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_read_timeout 86400;
        }

        # 静态资源
        location / {
            proxy_pass http://dustnote:3210;
            proxy_set_header Host $host;
        }
    }
}
```

### 3.6 申请证书（Let's Encrypt）

```bash
sudo apt install certbot
sudo certbot certonly --standalone -d note.example.com
# 复制证书到部署目录
cp /etc/letsencrypt/live/note.example.com/fullchain.pem ./certs/
cp /etc/letsencrypt/live/note.example.com/privkey.pem ./certs/
```

### 3.7 启动

```bash
docker compose up -d
docker compose logs -f dustnote
```

访问 `https://note.example.com`，开始使用。

## 4. 备份与恢复

> ⚠️ **现状校准（2026-09 审计）**：本节此前的示例脚本（bash 备份脚本 + GPG）为
> 示例性质，实际部署**不包含**这些脚本。备份由服务端进程内的
> backup-scheduler 自动执行。

### 4.1 自动备份（内置，无需配置）

- 启动 60 秒后跑第一次，之后每 24 小时一次
- SQLite Online Backup API 在线备份，不锁库
- 写入 BACKUP_DIR 卷（compose 默认 `/app/server/backups`），命名 `db-<时间戳>.sqlite`
- 滚动保留最近 30 份
- 失败时 logger.error + Sentry（若配置了 DSN）

**建议启用备份加密**：备份含 `users.totp_secret`、`wrapped_master_key` 等敏感材料，
不加密时等同生产库明文。设置环境变量后备份以 AES-256-GCM 加密落盘：

```bash
# .env
BACKUP_ENCRYPTION_KEY=<足够长的随机串>   # 丢失则备份不可恢复，请另行妥善保管
```

加密后产物为 `db-<时间戳>.sqlite.enc`，恢复前先解密：

```bash
docker exec -w /app/server dustnote node dist/scripts/backup.js \
  --decrypt /app/server/backups/db-xxx.sqlite.enc /tmp/restore.sqlite
```

安全取舍与信任边界的完整说明见 [security-model.md](./security-model.md)。

手动触发一次备份：

```bash
docker exec -w /app/server dustnote node -e \
  "require('better-sqlite3')('/app/server/data/dustnote.db').backup('/tmp/backup-manual.sqlite').then(()=>console.log('ok'))"
docker cp dustnote:/tmp/backup-manual.sqlite ./backup-$(date +%F).db
```

> 注意：直接 `docker cp` 主库文件不可靠——WAL 模式下数据可能还在
> `dustnote.db-wal` 里，必须用 backup API 生成一致性快照。
> 备份文件为明文 SQLite（含凭据哈希与分享密文），请按生产库敏感度保管。

### 4.2 恢复

```bash
# 停止服务（优雅停，WAL checkpoint）
docker compose down

# 用备份替换数据卷内容（卷名随 compose project 目录名，先 docker volume ls 核对）
docker volume inspect <project>_dustnote-data   # 确认挂载点
cp backup-YYYY-MM-DD.db /var/lib/docker/volumes/<project>_dustnote-data/_data/dustnote.db
rm -f /var/lib/docker/volumes/<project>_dustnote-data/_data/dustnote.db-wal*

# 修正属主（容器用户 dustnote=1001，否则 SQLITE_CANTOPEN）
chown -R 1001:0 /var/lib/docker/volumes/<project>_dustnote-data/_data

# 启动并验证
docker compose up -d
curl -f http://localhost:${PORT:-8080}/api/v1/health
```

恢复后建议做一次解锁验证（密码派生凭据随备份恢复，应与备份时一致）。

## 5. 升级

```bash
docker compose pull dustnote
docker compose up -d
docker compose logs -f dustnote
```

升级前**务必**先备份。

## 6. 监控

### 6.1 健康检查

```bash
curl https://note.example.com/api/v1/health
# {"ok":true,"uptime":12345,"version":"1.0.0"}
```

### 6.2 UptimeRobot / Uptime Kuma

添加监控：

- HTTPS：`https://note.example.com/api/v1/health`
- 频率：1 分钟
- 告警：邮件 / Webhook

### 6.3 库增长与 VACUUM（LIFE-022）

server 进程内置自动维护（`backup-scheduler.ts`）：WAL 每次备份前 `checkpoint(TRUNCATE)`、VACUUM 每约 7 日一次，
删除大量笔记后主库会**物理变小**，无需手动 VACUUM。紧急回收可 `docker exec dustnote node -e "require('better-sqlite3')('/app/server/data/dustnote.db').exec('VACUUM')"`。库体积增长主要由附件（`data/uploads/`）驱动，监控栈有 db size 曲线（`deploy/monitoring/`，建议 1GB 阈值告警）。详见 `DEPLOY.md` §9.3.1。

## 7. 安全加固

- [ ] 启用防火墙（仅开放 22/80/443）
- [ ] SSH 密钥登录 + 禁用密码
- [ ] fail2ban 防爆破
- [ ] 自动安全更新
- [ ] 定期更换 JWT_SECRET
- [ ] 启用 [HSTS Preload](https://hstspreload.org/)
- [ ] 配置 CSP（已在 nginx.conf 中提供）

## 8. 故障排除

| 现象            | 排查                                     |
| --------------- | ---------------------------------------- |
| 502 Bad Gateway | 容器未启动：`docker compose ps`          |
| 502 持续        | 后端崩溃：`docker compose logs dustnote` |
| 同步失败        | 检查 `WEB_ORIGIN` 是否正确               |
| 上传 413        | `client_max_body_size` 调大              |
| WS 断开         | Nginx 代理需配置 Upgrade 头（见 3.5）    |

## 9. 数据迁移

### 9.1 导出数据

设置 → 数据 → 全量导出 → 加密 ZIP

### 9.2 在另一台服务器恢复

1. 部署新服务
2. 创建主密码
3. 设置 → 数据 → 导入（v1.1+ 功能）
4. 或手动恢复 SQLite + attachments

### 9.3 卸载与数据清除（三路部署形态）

> 数据在 SQLite（`dustnote.db`）+ 附件（`uploads/`）+ 命名卷（`dustnote_data` / `dustnote_uploads`）。
> **清除数据前务必先做最后一次备份**（§6 / §9.1），误删不可逆。

**① Docker 容器部署**

```bash
# 停服务
docker compose down
# 清数据（命名卷）——先备份，再执行
docker volume inspect dustnote_data dustnote_uploads   # 确认识别
docker volume rm dustnote_data dustnote_uploads         # 删除卷（含 db + 附件）
# 若 compose 用 bind mount 到 ./data，则改为：
#   rm -rf ./data   （先 cp -r data data-backup 留底）
```

**② systemd 裸机部署**

```bash
sudo systemctl stop dustnote
sudo systemctl disable dustnote
# 清数据（数据目录，见 /opt/dustnote/.env 的 DATABASE_FILE 与 uploads 路径）
rm -rf /opt/dustnote/data /opt/dustnote/uploads   # 先留底
# 移除服务单元
sudo rm /etc/systemd/system/dustnote.service && sudo systemctl daemon-reload
# 移除代码目录（可选，保留 .env 以便重装复用密钥）
rm -rf /opt/dustnote
```

**③ 本地开发（pnpm dev）**

```bash
# 停 dev server（Ctrl+C 或 pkill）
# 清 dev 数据（client 本地 IndexedDB 与 server dev 目录）
rm -rf .tmp/dustnote/*.db*   # dev 用的 SQLite 与 WAL
# 浏览器端 IndexedDB 需在各浏览器 DevTools → Application → IndexedDB 手动清
```

**通用核对清单**：

- [ ] 卸载前已做最后一次完整备份（§9.1 导出或 `cp -r data data-backup`）？
- [ ] 数据卷 / 目录 / 文件已确认路径再删？
- [ ] 清数据后启动容器/服务验证「全新初始化」是否成功？
- [ ] `.env` 是否保留（JWT_SECRET 等）以便快速重装，还是同步删除（彻底清理）？

## 10. 高级

### 10.1 反向代理前置 Cloudflare

启用 Cloudflare 代理 + 配置 Origin 证书。

### 10.2 启用 IP 白名单

家庭网络 / VPN 后部署：

```nginx
location /api/ {
    allow 192.168.1.0/24;
    allow 10.0.0.0/8;
    deny all;
    # ...
}
```

### 10.3 多用户（v2.0）

v1.x 仅单用户，多用户需 v2.0 评估。
