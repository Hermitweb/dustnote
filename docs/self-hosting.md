# 自托管指南

> 适用版本：v1.0.0 及以上

本指南帮助你在自己的服务器上部署 DustNote。

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

### 3.3 docker-compose.yml

```yaml
version: '3.9'

services:
  dustnote:
    image: ghcr.io/your-org/dustnote:latest
    container_name: dustnote
    restart: unless-stopped
    ports:
      - '3210:3210'
    environment:
      - NODE_ENV=production
      - PORT=3210
      - JWT_SECRET=${JWT_SECRET}
      - DB_PATH=/data/dustnote.db
      - WEB_ORIGIN=https://note.example.com
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

  nginx:
    image: nginx:alpine
    container_name: dustnote-nginx
    restart: unless-stopped
    ports:
      - '443:443'
      - '80:80'
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - dustnote
```

### 3.4 .env

```bash
# 必填：JWT 签名密钥，至少 32 字符
JWT_SECRET=$(openssl rand -base64 48)

# 公网域名
WEB_ORIGIN=https://note.example.com
```

### 3.5 nginx.conf

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

### 4.1 备份

```bash
#!/bin/bash
# backup.sh
BACKUP_DIR=./backups
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# 备份 SQLite（安全方式）
docker exec dustnote sqlite3 /data/dustnote.db ".backup '/data/backup.db'"
docker cp dustnote:/data/backup.db $BACKUP_DIR/db_$TIMESTAMP.db

# 备份附件
tar czf $BACKUP_DIR/attachments_$TIMESTAMP.tar.gz ./data/attachments/

# 加密
gpg --symmetric --cipher-algo AES256 \
    --output $BACKUP_DIR/full_$TIMESTAMP.tar.gz.gpg \
    $BACKUP_DIR/db_$TIMESTAMP.db $BACKUP_DIR/attachments_$TIMESTAMP.tar.gz

# 清理临时
rm $BACKUP_DIR/db_$TIMESTAMP.db $BACKUP_DIR/attachments_$TIMESTAMP.tar.gz

# 删除 90 天前的
find $BACKUP_DIR -name "*.gpg" -mtime +90 -delete
```

加入 crontab：

```bash
0 3 * * * /path/to/backup.sh
```

### 4.2 恢复

```bash
# 停止服务
docker compose down

# 解密备份
gpg --decrypt backups/full_YYYYMMDD_HHMMSS.tar.gz.gpg | tar xz

# 还原
cp db_*.db data/dustnote.db
cp -r attachments/* data/attachments/

# 启动
docker compose up -d
```

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
