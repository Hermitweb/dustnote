# DustNote 服务状态

> 最近人工核对：2026-09-25（由 scripts/bump-version.mjs 随发版自动归一）

## 当前状态

🟢 **所有系统正常运行** — 服务端 **v2.5.44**（upgrade.sh 健康断言通过后即为线上态）

## 线上部署（自托管）

单节点部署（宝塔面板 + Docker Compose），Web / API / 下载分发同源：

| 组件                  | 状态    | 地址                                                 |
| --------------------- | ------- | ---------------------------------------------------- |
| Web 端（含 PWA）      | 🟢 正常 | `http://154.217.234.125:8080/`                       |
| 指标（/metrics）      | 🟡 可选 | 默认关闭，`METRICS_ENABLED=true` 开启后供监控抓取    |
| API                   | 🟢 正常 | `http://154.217.234.125:8080/api/v1/health`          |
| 同步（WebSocket）     | 🟢 正常 | 同源 `/sync/ws`（联机模式）                          |
| 分享服务              | 🟢 正常 | `http://154.217.234.125:8080/s/<token>`              |
| 更新分发（桌面/安卓） | 🟢 正常 | `http://154.217.234.125:8080/downloads/`             |
| 更新清单              | 🟢 正常 | `http://154.217.234.125:8080/api/v1/update-manifest` |

- 健康检查：Docker healthcheck 每 30 秒探活（`/api/v1/health`）
- 数据备份：服务端每日自动备份 SQLite（better-sqlite3 backup API，滚动保留）
- 发布通道：GitHub Actions 构建 → GitHub Release + 产物同步至服务器 `/opt/dustnote-downloads/`

## 客户端渠道

| 渠道          | 版本   | 分发方式                                   |
| ------------- | ------ | ------------------------------------------ |
| Web / PWA     | 2.5.44 | 服务器直出，Service Worker 缓存            |
| Windows x64   | 2.5.44 | 应用内更新 / GitHub Release                |
| Windows ARM64 | 2.5.44 | 应用内更新 / GitHub Release                |
| Android       | 2.5.44 | 应用内更新（manifest apk）/ GitHub Release |
| 微信小程序    | 2.5.44 | 微信平台（体验版/审核发布）                |
| macOS (ARM64) | 2.5.44 | GitHub Release（未签名 DMG，右键打开）     |
| iOS           | —      | 未发布                                     |

## 历史事件

- 2026-09-03：v2.5.40 发布当日出现一次用户侧「503 无法连接」误报，经排查为用户本地 VPN/代理链路生成，服务器侧零 5xx（详见 CHANGELOG 与诊断记录）。

## 说明

本文件随发版由维护者手工更新；当前为单维护者项目，暂无对外 SLA 承诺。
