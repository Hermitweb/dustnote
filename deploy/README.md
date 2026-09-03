# DustNote 部署指南

## 脚本分类（按平台）

| 脚本               | 平台          | 职责                                             |
| ------------------ | ------------- | ------------------------------------------------ |
| `install.sh`       | Linux / macOS | **一条命令入口**：从 GitHub 拉取部署包 + 部署    |
| `install.ps1`      | Windows       | **一条命令入口**：从 GitHub 拉取部署包 + 部署    |
| `deploy.sh`        | Linux / macOS | 部署执行：装 Docker → 生成 `.env` → `compose up` |
| `deploy.ps1`       | Windows       | 部署执行（同上）                                 |
| `nginx.conf`       | 通用          | 反代参考（裸机 / 已有 nginx）                    |
| `Caddyfile`        | 通用          | TLS 反代（自动 HTTPS）                           |
| `supervisord.conf` | 通用          | 容器内进程管理                                   |

## 一条命令安装部署（推荐）

无需先 clone 仓库，一条命令完成「从 GitHub 拉取部署包 → 解压 → 装 Docker → 生成 `.env` → 构建启动 → 健康检查」：

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/Hermitweb/dustnote/dev/setup-and-fixes/deploy/install.sh | bash

# 中国网络（aliyun apk / npmmirror / docker 镜像加速）
curl -fsSL https://raw.githubusercontent.com/Hermitweb/dustnote/dev/setup-and-fixes/deploy/install.sh | bash -s -- --cn

# 公网 + 域名（Caddy 自动 HTTPS）
curl -fsSL https://raw.githubusercontent.com/Hermitweb/dustnote/dev/setup-and-fixes/deploy/install.sh | bash -s -- --domain notes.example.com
```

### Windows

```powershell
powershell -ExecutionPolicy Bypass -Command "iwr -UseBasicParsing https://raw.githubusercontent.com/Hermitweb/dustnote/dev/setup-and-fixes/deploy/install.ps1 | iex"
```

> 指定版本：追加 `--version v2.5.27`（Linux/macOS）或 `-Version v2.5.27`（Windows）；默认自动获取 GitHub 最新 Release。

## 已有仓库 / 部署包：本地一键部署

若已 clone 仓库或已解压部署包，可直接在目录内运行（跳过拉取步骤）：

```bash
# Linux / macOS
./deploy/deploy.sh                 # HTTP（8080）
./deploy/deploy.sh --cn            # 中国网络
./deploy/deploy.sh --domain notes.example.com   # 公网 HTTPS
```

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Cn
```

脚本会自动完成：检测/安装 Docker → 配置镜像源（`--cn`）→ 生成随机 `JWT_SECRET` 的 `.env` → `docker compose up -d --build` → 等待健康检查 → 输出访问地址。

## 前置条件

- Docker 24+
- Docker Compose v2+
- 一键脚本可自动安装 Docker（Linux）；Windows 需先装 Docker Desktop

## 快速启动（HTTP）

适合本地开发或内网部署：

```bash
# 1. 复制环境变量配置（按需修改）
cp server/.env.example .env

# 2. 构建并启动
docker compose up -d --build

# 3. 查看日志
docker compose logs -f dustnote

# 4. 验证健康检查
curl http://localhost:8080/api/v1/health
```

访问 `http://localhost:8080` 即可使用。

## 生产部署（HTTPS）

使用 Caddy 自动申请 Let's Encrypt 证书：

```bash
# 1. 配置域名
echo "DOMAIN=notes.yourdomain.com" >> .env

# 2. 启动（含 Caddy 反向代理）
docker compose --profile tls up -d --build

# 3. 查看证书申请日志
docker compose logs -f caddy
```

访问 `https://notes.yourdomain.com` 即可。

> Caddy 会在首次启动时自动申请证书，请确保域名 DNS 已指向服务器 IP。

## 环境变量

| 变量             | 默认值                 | 说明                                    |
| ---------------- | ---------------------- | --------------------------------------- |
| `PORT`           | `8080`                 | 宿主机映射端口（HTTP 模式）             |
| `WEB_ORIGIN`     | `http://localhost`     | Web 前端 origin（CORS 白名单）          |
| `SERVER_VERSION` | `2.0.1`                | 服务端版本号                            |
| `JWT_SECRET`     | `dev-secret-change-me` | JWT 签名密钥（**生产必须修改**）        |
| `LOG_LEVEL`      | `info`                 | 日志级别（trace/debug/info/warn/error） |
| `DOMAIN`         | `localhost`            | 域名（仅 TLS 模式）                     |

## 常用命令

```bash
# 停止
docker compose down

# 停止并删除数据卷（⚠️ 不可恢复）
docker compose down -v

# 查看服务状态
docker compose ps

# 查看健康检查结果
docker inspect --format='{{.State.Health.Status}}' dustnote

# 进入容器
docker compose exec dustnote sh

# 备份数据库
docker compose exec dustnote cp /app/server/data/dustnote.db /tmp/dustnote-backup.db
docker cp dustnote:/tmp/dustnote-backup.db ./dustnote-backup.db

# 升级版本
git pull
docker compose up -d --build
```

## 架构

```
                    ┌─────────────────────────────────┐
                    │         Docker Host              │
                    │                                   │
  :80/:443 ────────►│  Caddy (TLS 模式)                 │
                    │    ↓ reverse_proxy                │
                    │  dustnote:3210                    │
                    │    ↓                              │
  :8080 ───────────►│  dustnote (HTTP 模式, 直连)       │
                    │    ↓                              │
                    │  dustnote-data (SQLite 卷)        │
                    └─────────────────────────────────┘
```

- **HTTP 模式**：宿主机 :8080 → 容器 :3210，适合反代已有 Nginx
- **TLS 模式**：Caddy :80/:443 → dustnote :3210，自动 HTTPS

## 健康检查

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

Docker 内置健康检查每 30 秒调用一次，3 次失败后标记 unhealthy。

## 故障排查

### 容器启动失败

```bash
docker compose logs dustnote
```

常见原因：

- 端口被占用：修改 `.env` 中的 `PORT`
- 数据卷权限：确保 `dustnote-data` 卷可写

### 数据库锁定

SQLite 在高并发下可能出现锁定。DustNote 使用 WAL 模式，单实例部署足够。
如需多实例，请改用外部 PostgreSQL（未来支持）。

### Caddy 证书申请失败

- 确认域名 DNS 已指向服务器
- 确认 80/443 端口已开放
- 查看 Caddy 日志：`docker compose logs caddy`
