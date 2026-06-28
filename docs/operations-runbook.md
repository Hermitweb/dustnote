# MintNote 运维手册（Runbook）

> 适用：服务端运维
> 紧急联系：[oncall@mintnote.app](mailto:oncall@mintnote.app)

## 1. 应急联系方式

| 角色 | 联系方式 | 响应时间 |
|------|----------|----------|
| On-call 工程师 | oncall@mintnote.app | 7×24 |
| 安全事件 | security@mintnote.app | 24h |
| 业务方 | hello@mintnote.app | 24h |

## 2. 故障分级

| 等级 | 含义 | 示例 | 响应 SLA |
|------|------|------|----------|
| P0 | 服务完全不可用 | 服务宕机、数据丢失 | 15 分钟 |
| P1 | 核心功能受损 | 登录失败、同步断裂 | 1 小时 |
| P2 | 部分功能受损 | 主题不生效、分享异常 | 4 小时 |
| P3 | 非关键问题 | UI 错位、文档错误 | 24 小时 |

## 3. 监控与告警

### 3.1 关键指标

| 指标 | 来源 | 阈值 | 告警 |
|------|------|------|------|
| 服务可用率 | UptimeRobot | < 99.9% | P0 |
| API P95 延迟 | Prometheus | > 1s | P1 |
| 5xx 错误率 | Prometheus | > 1% | P1 |
| CPU 使用率 | node_exporter | > 80% | P2 |
| 内存使用率 | node_exporter | > 80% | P2 |
| 磁盘使用率 | node_exporter | > 80% | P2 |
| 数据库文件大小 | 自定义 | > 1GB | P2 |
| 登录失败率（IP） | 自定义 | > 5/min | P1 |
| 备份成功率 | cron + log | 失败 | P1 |

### 3.2 告警通道

- PagerDuty / 飞书 / 钉钉 Webhook
- 邮件 oncall@mintnote.app
- SMS（仅 P0）

## 4. 常见故障处理

### 4.1 服务宕机（P0）

**症状**：UptimeRobot 告警 / 主动反馈

**步骤**：
1. SSH 登录服务器
2. 检查容器状态：`docker compose ps`
3. 查看日志：`docker compose logs --tail=200 mintnote`
4. 常见原因：
   - 内存 OOM → 降低 Node.js `--max-old-space-size`
   - 磁盘满 → `df -h`，清理日志 / 备份
   - 配置错误 → 检查 `.env`、Nginx
5. 重启：`docker compose restart mintnote`
6. 验证：`curl https://note.example.com/api/v1/health`
7. 发事故公告：status.mintnote.app + 群通知

### 4.2 数据库损坏

**症状**：API 5xx 持续，写入失败

**步骤**：
1. 立即停止写入：`docker compose stop mintnote`
2. 备份当前文件：`cp data/mintnote.db data/mintnote.db.crash`
3. 尝试修复：
   ```bash
   docker run --rm -v $PWD/data:/data alpine sh -c \
     "apk add sqlite && sqlite3 /data/mintnote.db '.recover' | sqlite3 /data/mintnote_recovered.db"
   ```
4. 替换：`mv data/mintnote_recovered.db data/mintnote.db`
5. 重启：`docker compose up -d mintnote`
6. 验证并通知用户
7. 触发备份恢复流程（如仍异常）

### 4.3 备份失败

**症状**：cron 告警 / 备份文件缺失

**步骤**：
1. 检查 cron 服务：`systemctl status cron`
2. 手动执行：`bash backup.sh` 排查错误
3. 常见原因：
   - 磁盘满 → 清理旧备份
   - GPG 密钥问题 → 检查 `~/.gnupg`
   - 容器未运行 → `docker compose up -d mintnote`
4. 修复后手动补一次备份

### 4.4 同步大面积失败

**症状**：客户端报错"同步失败"

**步骤**：
1. 检查 WebSocket：`wscat -c wss://api.mintnote.app/sync/ws?access_token=test`
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

1. CI 全绿 → 镜像 `ghcr.io/.../mintnote:v1.x.y`
2. 在 staging 验证（详见 §7）
3. 维护窗口内 `docker compose pull && up -d`
4. 观察 5 分钟 → 健康检查 → 切流量
5. 通知用户"已完成升级"

### 6.2 回滚

```bash
# 拉取旧版本
docker pull ghcr.io/your-org/mintnote:v1.x.(y-1)
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

| 资源 | 当前 | 6 个月预测 | 12 个月预测 | 行动阈值 |
|------|------|-----------|-----------|----------|
| CPU | 30% | 40% | 50% | > 70% 升级 |
| 内存 | 1GB / 2GB | 1.2GB | 1.5GB | > 80% 升级 |
| 磁盘 | 5GB / 20GB | 8GB | 15GB | > 80% 扩容 |
| 带宽 | 10Mbps | 20Mbps | 50Mbps | > 70% 升级 |
| 数据库大小 | 50MB | 200MB | 500MB | > 1GB 评估 |

## 9. 安全事件响应

详见 [security.md §13](../.trae/documents/security.md)

## 10. 关键脚本位置

```
/opt/mintnote/
├── docker-compose.yml
├── .env
├── backup.sh
├── restore.sh
├── logs/
└── data/
    ├── mintnote.db
    └── attachments/
```

## 11. 值班交接

每次 On-call 轮转前需：

- [ ] 阅读上周事故报告
- [ ] 检查所有监控正常
- [ ] 确认 SSH 密钥、Vault 权限有效
- [ ] 测试告警通道
- [ ] 更新值班表
