# DustNote 服务状态

<!-- status-probe:start -->

> 最近拨测：2026-09-26 15:29 UTC · 🟢 全部通过 · 期望版本 v2.5.45

**当前状态：🟢 正常** — 线上 **v2.5.45**（探针判定，非人工声明）

| 探测项                        | 结果 | 耗时  | HTTP | 说明                                          |
| ----------------------------- | ---- | ----- | ---- | --------------------------------------------- |
| health                        | ✅   | 690ms | 200  |                                               |
| update-manifest               | ✅   | 658ms | 200  |                                               |
| web                           | ✅   | 204ms | 200  |                                               |
| share-api                     | ✅   | 212ms | 404  |                                               |
| http-plaintext(informational) | ℹ️   | 0ms   | 200  | 明文仍可服务（status=200，R1 HTTPS 收口待办） |

_未列入本表的组件（WebSocket 同步、/metrics）探针不覆盖，状态见下方「拨测不覆盖的部分」。_

<!-- status-probe:end -->

> 上面这一段由探针生成（CI 每 6h 跑一次），**手改无效**：下一次拨测会覆盖。
> 发版脚本也不写这一段——"线上是什么"只能由探测得出，不能由"我刚发了版"推出。

## 线上部署（自托管）

单节点部署（宝塔面板 + Docker Compose），Web / API / 下载分发同源：

| 组件                  | 地址                                            |
| --------------------- | ----------------------------------------------- |
| Web 端（含 PWA）      | `https://napi.iniess.cn/`                       |
| API                   | `https://napi.iniess.cn/api/v1/health`          |
| 同步（WebSocket）     | 同源 `/sync/ws`（联机模式）                     |
| 分享服务              | `https://napi.iniess.cn/s/<token>`              |
| 更新分发（桌面/安卓） | `https://napi.iniess.cn/downloads/`             |
| 更新清单              | `https://napi.iniess.cn/api/v1/update-manifest` |
| 指标（/metrics）      | 默认关闭，`METRICS_ENABLED=true` 后供监控抓取   |

- 健康检查：Docker healthcheck 每 30 秒探活（`/api/v1/health`）
- 数据备份：服务端每日自动备份 SQLite（better-sqlite3 backup API，滚动保留）
- 发布通道：GitHub Actions 构建 → GitHub Release + 产物同步至服务器 `/opt/dustnote-downloads/`

## 拨测不覆盖的部分

探针只能证明"HTTP 面"。以下项目**不在这页上声明状态**，因为没人验证过就是猜测：

| 项目           | 为什么探针不覆盖                              | 现状证据在哪                        |
| -------------- | --------------------------------------------- | ----------------------------------- |
| WebSocket 同步 | 需要真实握手 + 会话，拨测会引入账号与密钥依赖 | 服务端日志 / 客户端诊断上报         |
| `/metrics`     | 默认关闭（未开 `METRICS_ENABLED`）            | 开启后由 Prometheus 抓取，见 deploy |
| 微信小程序     | 发布与审核在微信平台，不由本仓库部署          | 微信平台（体验版 / 审核发布）       |
| 备份可恢复性   | 恢复演练是人工动作，不能自动断言              | `docs/operations-runbook.md` 演练节 |

## 客户端渠道

（本表由 `scripts/bump-version.mjs` 随发版归一——它写的是"我们发布了什么"，不是"线上跑着什么"）

| 渠道          | 版本   | 分发方式                                   |
| ------------- | ------ | ------------------------------------------ |
| Web / PWA     | 2.5.45 | 服务器直出，Service Worker 缓存            |
| Windows x64   | 2.5.45 | 应用内更新 / GitHub Release                |
| Windows ARM64 | 2.5.45 | 应用内更新 / GitHub Release                |
| Android       | 2.5.45 | 应用内更新（manifest apk）/ GitHub Release |
| macOS (ARM64) | 2.5.45 | GitHub Release（未签名 DMG，右键打开）     |
| iOS           | —      | 未发布                                     |

## 历史事件

- 2026-09-03：v2.5.40 发布当日出现一次用户侧「503 无法连接」误报，经排查为用户本地 VPN/代理链路生成，服务器侧零 5xx（详见 CHANGELOG 与诊断记录）。

## 说明

- 本项目为单维护者自托管服务，**无对外 SLA 承诺**；本页是"能外部核实的事实"，不是服务等级协议。
- 地址一律写 `napi.iniess.cn`：历史上文档与小程序引导地址曾指向裸 IP + 明文端口
  （审计 `PLAT-004`），现在小程序引导地址、本页、README 三处同源。
