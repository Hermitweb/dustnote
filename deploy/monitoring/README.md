# 监控栈（P0-2）

Prometheus + Alertmanager + ntfy 桥，对 DustNote 主栈做指标告警。与主 compose
完全隔离（独立文件/项目名/卷），主栈升级回滚互不影响。

## 启用步骤（服务器）

1. 主栈开启指标出口：`.env` 追加（token 用 `openssl rand -hex 24` 生成），
   然后 `docker compose up -d` 重建生效：

   ```
   METRICS_ENABLED=true
   METRICS_TOKEN=<随机串>
   ```

2. 生成抓取凭据文件（与主栈 token 同值的纯文本单行，600 权限）：

   ```bash
   grep ^METRICS_TOKEN .env | cut -d= -f2 > /opt/metrics-token.txt
   chmod 600 /opt/metrics-token.txt
   chown 65534:65534 /opt/metrics-token.txt  # prometheus 容器以 nobody 运行，
                                             # 属主不对会 unable to read credentials file
   ```

3. 启动监控栈：

   ```bash
   cd deploy/monitoring
   cp .env.monitoring.example .env.monitoring   # 只需 NTFY_TOPIC（openssl rand -hex 12）
   docker compose -f compose.monitoring.yml --env-file .env.monitoring up -d
   ```

3. 手机安装 ntfy → 订阅步骤 2 里的 `NTFY_TOPIC` → 应立刻收到一条测试可达的
   通知渠道（首次告警即验证）。

## 告警规则

复用仓库 `deploy/prometheus/rules.yml`：宕机（`up==0` 2 分钟）、5xx 比率、
备份失败/停摆、认证锁定激增、库体积。critical 10 秒成组即推、每小时重复；
warning 30 分钟聚批、每日重复；宕机时抑制派生 warning（根因优先）。

## 面板访问

Prometheus `:9090`、Alertmanager `:9093` 只绑 127.0.0.1——远程查看走 SSH 隧道：

```bash
ssh -L 9090:localhost:9090 -L 9093:localhost:9093 root@<server>
```

## 演练（roadmap P0-2 验收：拔容器 2 分钟内收到告警）

```bash
scripts/alert-drill.sh          # 自动：down 主栈→观察规则触发→up 恢复→确认 resolved
```

## 安全边界

- `/metrics` 带 Bearer token；两个 web UI 不对外网暴露（仅 127.0.0.1）。
- ntfy topic 是"谁能给你发消息"的凭据：泄露只会被塞垃圾通知，不泄露任何
  指标内容（消息正文只含告警名与摘要）。若怀疑泄露：换 topic 重启 bridge。
