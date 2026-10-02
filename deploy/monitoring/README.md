# 监控栈（P0-2）

四个容器：prometheus、alertmanager、自写的 ntfy-bridge、以及自托管的 ntfy 服务。
对 DustNote 主栈做指标告警。与主 compose 完全隔离（独立文件/项目名/卷），主栈升级回滚互不影响。
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
   cp .env.monitoring.example .env.monitoring   # 填 NTFY_TOPIC（openssl rand -hex 12）；
   # NTFY_SERVER 可逗号分隔多目标，示例里同时投公网与本机自托管 ntfy（见下文"现实"一节）
   docker compose -f compose.monitoring.yml --env-file .env.monitoring up -d
   ```

4. 手机安装 ntfy → 订阅步骤 3 那份 `.env.monitoring` 里的 `NTFY_TOPIC` → 跑一次
   `scripts/alert-drill.sh --smoke`，手机收到 `[!!] DrillSmokeAlert*` 即链路全通。
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
现在 bridge 数着送达条数：**一条都没推出去就回 502**（让 Alertmanager 按自己的策略重试），

`/stats` 的字段与多目标语义（NTFY_SERVER 逗号分隔时逐目标投递）：

| 字段                    | 含义                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `received`              | 收到的 webhook 批次                                                                   |
| `published` / `failed`  | 成功的「消息 × 目标」/失败的「消息 × 目标」——双目标全通时一条告警 +2                  |
| `delivered`（响应体里） | **至少送达一个目标**的消息条数，502 判据用它；用 `published` 判会把"只通一路"读成全通 |
| `partial`               | 送达了但有目标失败的消息数                                                            |
| `byTarget`              | 逐目标计数，公网通了也掩盖不了自托管那路在挂                                          |

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
- ntfy topic 就是访问凭据本身，ntfy 默认保留最近 12h 消息：**拿到 topic 的人既能往里
  灌垃圾通知，也能读到已发出的告警正文**（含告警名、summary 与 description，其中有
  job 名/端口这类信息）。怀疑泄露就换 topic 并重启 bridge，别指望"只是被发垃圾"。
- 自托管 ntfy 只绑 `127.0.0.1:5000`，对外发布/订阅必须经带 TLS 的反代；未配反代前它
  只承担"链路自证"，手机侧投递仍走公网目标（见下一节）。

## 这套东西曾经"看着在跑、其实全断"（2026-10-02 实测）

不是假想风险，是发生过的事，三条证据都能复跑：

1. **线上 bridge 是 P0-2 修复前的旧版**。监控栈的 bind mount 钉在**首次部署**的版本目录
   （`/opt/dustnote-server-v2.5.45/...`），主栈换代只重建主容器，监控三个容器原地不动——
   于是仓库里修好的 `bridge.mjs`（5171 B）从未上线，线上仍是 2590 B 的旧版，`GET /stats` 直接 404。
   `deploy/upgrade.sh` 第 7 步现在会重建监控栈**并断言挂载源已指向新目录**，断言不成立就 die。
2. **推送目标根本不存在**。服务器上的 `.env.monitoring` 写着 `NTFY_SERVER=http://ntfy:5000`，
   而本文件当时从未定义 ntfy 服务：无容器、无进程、DNS 也不解析。旧 bridge 照样回 `ok:true`，
   Alertmanager 认为已送达、永不重试——"有告警系统"在这次实测之前一直是"没有告警系统"。
3. **没有任何一条断言看过线上那个文件是谁**。CI 绿、`bridge.test.mjs` 绿、状态页绿。
   `alert-drill.sh --smoke` 本可以第一次就抓出来（读不到 `/stats` 即 FAIL），但它从未被跑过。

剩下的外部依赖：手机要订阅**自托管** ntfy，还缺一条 DNS A 记录——`*.iniess.cn` 泛解析指向
另一台机器（154.217.234.79），只有 `napi.iniess.cn` 是显式 A 记录。记录加好后再上 TLS 反代，
然后把 `NTFY_SERVER` 里公网那项摘掉即可（bridge 无需改动）。在那之前两路同投，任一路达即达。
