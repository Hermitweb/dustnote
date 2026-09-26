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

4. 手机安装 ntfy → 订阅步骤 2 里的 `NTFY_TOPIC` → 应立刻收到一条测试可达的
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

## 验收：投递要可证明，不靠人看手机

Alertmanager 的 webhook 只有拿到 4xx/5xx 才会重试。旧 bridge 无论 ntfy 成败都回
200，等于**topic 填错或 ntfy 不可达时静默丢告警**——"有告警系统"悄悄变成"没有"。
现在 bridge 数着送达条数：一条都没推出去就回 502（让 Alertmanager 重试），
并把 received/published/failed 暴露在 `GET /stats`，演练脚本据此断言最后一跳。

```bash
scripts/alert-drill.sh --smoke   # 冒烟：投一条合成告警走完整链路，不动主栈（日常用这个）
scripts/alert-drill.sh           # 全量演练：down 主栈 → 等 firing → 恢复 → 核对最后一跳
```

bridge 没对外发布端口（只在内网），脚本经 `docker compose exec ntfy-bridge wget` 读它：

```bash
cd deploy/monitoring
docker compose -f compose.monitoring.yml exec -T ntfy-bridge wget -qO- http://127.0.0.1:9095/stats
```

映射逻辑本身有单测（`bridge.test.mjs`，`pnpm test:monitoring`，已进 CI）：
critical→priority 5、resolved→3、缺字段兜底、畸形载荷不炸、全失败必须报零送达。

## 安全边界

- `/metrics` 带 Bearer token；两个 web UI 不对外网暴露（仅 127.0.0.1）。
- ntfy topic 是"谁能给你发消息"的凭据：泄露只会被塞垃圾通知，不泄露任何
  指标内容（消息正文只含告警名与摘要）。若怀疑泄露：换 topic 重启 bridge。
