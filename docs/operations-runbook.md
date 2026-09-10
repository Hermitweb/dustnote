# DustNote 运维手册（Runbook）

> 适用：服务端运维
> 紧急联系：[oncall@dustnote.app](mailto:oncall@dustnote.app)

## 1. 应急联系方式

| 角色           | 联系方式              | 响应时间 |
| -------------- | --------------------- | -------- |
| On-call 工程师 | oncall@dustnote.app   | 7×24     |
| 安全事件       | security@dustnote.app | 24h      |
| 业务方         | hello@dustnote.app    | 24h      |

## 2. 故障分级

| 等级 | 含义           | 示例                 | 响应 SLA |
| ---- | -------------- | -------------------- | -------- |
| P0   | 服务完全不可用 | 服务宕机、数据丢失   | 15 分钟  |
| P1   | 核心功能受损   | 登录失败、同步断裂   | 1 小时   |
| P2   | 部分功能受损   | 主题不生效、分享异常 | 4 小时   |
| P3   | 非关键问题     | UI 错位、文档错误    | 24 小时  |

## 3. 监控与告警

> ⚠️ **现状校准（2026-09 审计）**：本节此前描述的 Prometheus / UptimeRobot /
> PagerDuty 栈**并未实际部署**（代码与 compose 中均不存在），属规划性内容。
> 当前实际存在的监控面如下：

### 3.1 实际可用的监控手段

| 手段 | 说明 | 判定方法 |
| ---- | ---- | ---- |
| Docker healthcheck | compose 内置,30s 间隔 curl /api/v1/health | `docker inspect -f '{{.State.Health.Status}}' dustnote` |
| 应用健康端点 | 返回 version,不泄露业务规模 | `curl http://<host>:<port>/api/v1/health` |
| Sentry 错误聚合 | **仅在 .env 配置 SENTRY_DSN 时启用**,未配置为 no-op | Sentry 控制台 |
| 结构化日志 | pino JSON 日志(含 40+ 字段脱敏),`docker compose logs` | grep error/warn |
| 备份监控 | backup-scheduler 失败会 logger.error + captureException(配置 DSN 时) | `docker compose logs dustnote \| grep 备份失败` |

### 3.2 待建设的告警能力（规划）

- 外部拨测(UptimeRobot 类)对 /api/v1/health 的可用率监控
- 备份文件按日存在性巡检(脚本核对 backups 卷内当日 db-*.sqlite)
- Prometheus /metrics 端点(当前未实现)

## 4. 常见故障处理

### 4.1 服务宕机（P0）

**症状**：UptimeRobot 告警 / 主动反馈

**步骤**：

1. SSH 登录服务器
2. 检查容器状态：`docker compose ps`
3. 查看日志：`docker compose logs --tail=200 dustnote`
4. 常见原因：
   - 内存 OOM → 降低 Node.js `--max-old-space-size`
   - 磁盘满 → `df -h`，清理日志 / 备份
   - 配置错误 → 检查 `.env`、Nginx
5. 重启：`docker compose restart dustnote`
6. 验证：`curl https://note.example.com/api/v1/health`
7. 发事故公告：status.dustnote.app + 群通知

### 4.2 数据库损坏

**症状**：API 5xx 持续，写入失败

**步骤**：

1. 立即停止写入：`docker compose stop dustnote`
2. 备份当前文件：`cp data/dustnote.db data/dustnote.db.crash`
3. 尝试修复：
   ```bash
   docker run --rm -v $PWD/data:/data alpine sh -c \
     "apk add sqlite && sqlite3 /data/dustnote.db '.recover' | sqlite3 /data/dustnote_recovered.db"
   ```
4. 替换：`mv data/dustnote_recovered.db data/dustnote.db`
5. 重启：`docker compose up -d dustnote`
6. 验证并通知用户
7. 触发备份恢复流程（如仍异常）

### 4.3 备份失败

> ⚠️ **现状校准（2026-09 审计）**：备份由**服务端进程内** backup-scheduler 执行
> （启动 60s 后一次,之后每 24h 一次,保留最近 30 份）,不走系统 cron,
> 也**没有 backup.sh / GPG 加密**。备份文件为明文 SQLite,敏感度等同生产库。

**症状**：日志出现「备份失败」关键字 / backups 卷内文件日期停滞

**步骤**：

1. 查日志定位错误：`docker compose logs --tail=500 dustnote | grep 备份`
2. 手动触发一次（容器内）：
   ```bash
   docker exec dustnote node -e "import('./dist/scripts/backup.js').then(m=>m.runBackup())"
   ```
   或直接调 better-sqlite3 backup API：
   ```bash
   docker exec -w /app/server dustnote node -e "require('better-sqlite3')('/app/server/data/dustnote.db').backup('/tmp/backup-manual.sqlite').then(()=>console.log('ok'))"
   ```
3. 常见原因：
   - backups 卷权限错误（SQLITE_CANTOPEN）→ `chown -R 1001:0` 备份卷（容器用户 dustnote=1001）
   - 磁盘满 → 清理旧备份（调度自带 30 份滚动保留）
   - 数据卷迁移后忘改权限 → 见 DEPLOY.md 跨版本升级流程
4. 修复后核对 backups 目录出现当日 `db-*.sqlite`
5. **恢复演练（建议每季度一次）**：取最近一份备份,在隔离环境启动容器指向该
   文件,验证 unlock + 笔记列表可正常返回

### 4.4 同步大面积失败

**症状**：客户端报错"同步失败"

**步骤**：

1. 检查 WebSocket：`wscat -c wss://api.dustnote.app/sync/ws?access_token=test`
2. 检查 Nginx 配置中的 Upgrade 头
3. 检查后端日志中的 WS 错误
4. 检查防火墙是否放行 443 出站
5. 必要时降级为轮询（已在客户端实现）

### 4.5 主密码泄露

**步骤**：

1. 紧急联系用户确认
2. 强制所有 Refresh Token 失效
3. 轮换 JWT_SECRET（需所有用户重新登录）
4. 检查异常访问日志
5. 通知所有已登录用户

### 4.6 数据泄露（密文）

**症状**：检测到 SQL 注入成功 / 数据库文件外泄

**步骤**：

1. 立即隔离：停止服务 / 断网
2. 评估泄露范围：哪些表、哪些记录
3. 强制所有会话失效
4. 轮换 JWT_SECRET
5. 24h 内通知所有用户
6. 30 天后公开 postmortem
7. 修补漏洞后再上线

## 5. 维护窗口

- **常规维护**：每周二 03:00-05:00（提前 7 天公告）
- **紧急维护**：随时进行 + 实时公告

## 6. 部署流程

### 6.1 正常发布

1. CI 全绿 → 镜像 `ghcr.io/.../dustnote:v1.x.y`
2. 在 staging 验证（详见 §7）
3. 维护窗口内 `docker compose pull && up -d`
4. 观察 5 分钟 → 健康检查 → 切流量
5. 通知用户"已完成升级"

### 6.2 回滚

```bash
# 拉取旧版本
docker pull ghcr.io/your-org/dustnote:v1.x.(y-1)
# 修改 docker-compose.yml 镜像 tag
docker compose up -d
# 验证
curl https://note.example.com/api/v1/health
```

## 7. 预发布验证

staging 环境（独立域名）跑：

- [ ] 健康检查通过
- [ ] 主密码设置 + 解锁
- [ ] 笔记 CRUD
- [ ] 主题切换
- [ ] 分享创建 + 公开访问
- [ ] WebSocket 实时同步
- [ ] 导入 .docx
- [ ] 导出 JSON
- [ ] 备份与恢复
- [ ] 错误监控接入正常

## 8. 容量规划

| 资源       | 当前       | 6 个月预测 | 12 个月预测 | 行动阈值   |
| ---------- | ---------- | ---------- | ----------- | ---------- |
| CPU        | 30%        | 40%        | 50%         | > 70% 升级 |
| 内存       | 1GB / 2GB  | 1.2GB      | 1.5GB       | > 80% 升级 |
| 磁盘       | 5GB / 20GB | 8GB        | 15GB        | > 80% 扩容 |
| 带宽       | 10Mbps     | 20Mbps     | 50Mbps      | > 70% 升级 |
| 数据库大小 | 50MB       | 200MB      | 500MB       | > 1GB 评估 |

## 9. 安全事件响应

详见 [security.md §13](../.trae/documents/security.md)

## 10. 关键脚本位置

> ⚠️ **现状校准（2026-09 审计）**：`backup.sh` / `restore.sh` / `attachments/`
> 不存在——备份走进程内 backup-scheduler,数据在命名卷内。真实布局：

```
/opt/dustnote-server-v<version>/   # 每版本一个目录(compose project 名随之)
├── docker-compose.yml
└── .env                           # SERVER_VERSION/RECOMMENDED_CLIENT_VERSION/WEB_ORIGIN/JWT_SECRET
命名卷（随 compose project 命名,跨版本需迁移）:
├── <project>_dustnote-data        # → /app/server/data/dustnote.db（WAL 模式）
└── <project>_dustnote-backups     # → /app/server/backups/db-*.sqlite（滚动 30 份）
宿主:
└── /opt/dustnote-downloads/       # 发版产物(exe/apk),update-manifest 动态算 sha256
```

**备份一致性提取**（容器内无 sqlite3 CLI,直接 cp 主库文件只有 4KB——数据在 WAL）：

```bash
docker exec -w /app/server dustnote node -e "require('better-sqlite3')('/app/server/data/dustnote.db').backup('/tmp/x.db').then(()=>console.log('ok'))"
docker cp dustnote:/tmp/x.db ./backup-$(date +%F).db
```

## 11. 值班交接

每次 On-call 轮转前需：

- [ ] 阅读上周事故报告
- [ ] 检查所有监控正常
- [ ] 确认 SSH 密钥、Vault 权限有效
- [ ] 测试告警通道
- [ ] 更新值班表
