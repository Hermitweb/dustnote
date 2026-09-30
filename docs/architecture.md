# 架构总览

> 这篇讲「现在为什么是这样」。历史与逐条整改记录在
> [audit-fixes-2026-09-19](audit-fixes-2026-09-19.md)、[audit-fixes-2026-09-21](audit-fixes-2026-09-21.md)
> 与[路线图](roadmap.md)里；重要取舍的因果另见 [ADR](adr/README.md)。

## 包与依赖方向

```
shared  ←─ client-core ←─┬─ web ─┐
   │                     ├─ desktop (Tauri 复用 web 组件)
   │                     ├─ mobile (React Native)
   └─────────────────────┴─ miniprogram (Taro)
                         server (独立，只依赖 shared)
```

| 包            | 职责                                                                     | 为什么在这一层                                           |
| ------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| `shared`      | 加密原语、KDF 参数、主题令牌/引擎、协议与校验 schema、纯函数工具         | 客户端与服务端**必须**算出同样的字节，任何一份拷贝都会漂 |
| `client-core` | 信封加解密、同步引擎、离线队列、冲突存储、设备 ID、模式状态、i18n 运行时 | 五端的这些行为必须逐字一致，之前四端各写一份就是漂移源   |
| `web`         | React + TipTap 的界面与 IndexedDB 存储层                                 | 也是 desktop 的 UI 来源                                  |
| `desktop`     | Tauri 壳 + 原生能力（文件、自动更新、托盘）                              | 复用 web 组件，只加平台适配                              |
| `mobile`      | React Native 界面与原生加密/存储绑定                                     | Hermes 无 JIT，性能相关的取舍都在这层消化                |
| `miniprogram` | Taro 小程序 + H5 双目标                                                  | 缺 WebCrypto，靠 `crypto-polyfill` 补安全随机与 UTF-8    |
| `server`      | Express + better-sqlite3、鉴权、版本校验、分享、指标                     | 单用户自托管模型：不持有明文，也不做数据富化             |

## 加密边界

- 主密码 → `PBKDF2-SHA256 × 100000`（默认）派生 IKM，再经 HKDF 分叉成 **KEK**（封装主密钥）与
  **authKey**（服务端身份校验）。服务端拿到 authKey 也推不出 KEK。
- 历史账号可能仍是 Argon2id 参数；派生参数随账号记录，两条路径并存可解锁——**不做静默迁移**。
- 每条笔记单独 `AES-256-GCM`，AAD 绑定 `noteId ‖ userId`：把 A 的密文挪到 B 会直接认证失败。
- Web 本地缓存写 IndexedDB 前先用主密钥派生的 localDEK 加密；明文不落磁盘。
- 密钥材料一律 `randomBytes()`（拿不到安全熵就抛错）；**只有** AES-GCM 的 IV 允许用只保证唯一性的
  通道 `randomUniqueBytes()`。见 [ADR-0003](adr/0003-random-source-two-channels.md)。

## 数据流（联机模式）

```
客户端写 → 本地密文信封 + 待同步队列
        → POST /api/v1/notes（服务端只搬密文，按 version 做乐观锁）
        → broadcastNoteChanged → WebSocket 推送给同用户其他端
其他端   → GET /api/v1/notes?since=<ts>（增量游标 server_updated_at|id）
        → 版本号落后/冲突进 conflict-store，由人裁决，不自动最后写入
```

单机模式没有后两段：`mode-store` 决定仓库实现走本地还是远端，界面层不感知。

## 请求链与部署拓扑

```
浏览器/客户端 → LB 或 Caddy（TLS 在这一层）→ 容器 :8080 nginx
    location / → /app/web-dist 静态（SPA fallback 到 index.html）
    location /downloads/ → 安装包，独立限流
    location /api/  → 反代 127.0.0.1:3210 node
    location = /metrics → 反代 node（默认 404，METRICS_ENABLED 才开）
```

- 容器是一体化的（nginx + node 由 supervisor 管），监听非特权 8080，因此**页面响应头由 nginx
  下发**；`server/src/app.ts` 里 helmet 的 `contentSecurityPolicy: false` 是刻意不重复下发。
- `add_header` 在 nginx 里**不继承**：子 `location` 只要自己写过任意一条，父级安全头就整组消失。
  这条踩过的坑由 `pnpm security:headers` 静态守卫 + 外部拨测的 `csp-page` 断言共同看住。
- 镜像构建的 COPY 是白名单语义，历史上两次「CI 绿、现场炸」都源于此，故有 `pnpm docker:check`。

## 观测与自证

| 层面         | 手段                                                 | 谁在看着它                                             |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------ |
| 服务存活     | `/api/v1/health`（版本 + db 状态）                   | 服务器本机 Prometheus                                  |
| 指标         | `/metrics`（默认关，可选 Bearer）                    | 本机监控栈                                             |
| 外部视角     | `scripts/status-probe.mjs` 从 GitHub 网络位置拨测    | `nightly-status.yml` 排期 + 手动触发                   |
| 状态页       | 由探针生成，不由人手写                               | `docs/status.md` 的生成区标记                          |
| 告警投递     | Alertmanager → `deploy/monitoring/bridge.mjs` → ntfy | 零送达即 502，让 Alertmanager 重试                     |
| 报警链路自身 | 拨测失败由**独立 report job** 开 issue               | 见 [ADR-0004](adr/0004-monitor-report-separate-job.md) |

最后一条是这两天学到的：报警器和分析对象在同一个 job 里时，job 起不来就等于什么都没发生。

## 质量门禁

每道门禁都对应一次真实事故或一个可预见的静默失效，来历记在
[CONTRIBUTING.md](../CONTRIBUTING.md) 的门禁表里。核心几条：

- `pnpm typecheck` / `lint` / `format:check`：跨包类型与规范一致；
- `pnpm test`：各包单测（vitest）+ `test:monitoring`（Node 原生 test runner 跑运维脚本）；
- `pnpm exec playwright test`：e2e 含视觉基线与对比度断言；
- `pnpm codeql`（CI 每次 push）+ `pnpm audit`；
- `pnpm docker:check`：镜像 COPY 白名单与跨包引用对齐；
- `pnpm security:headers` / `action:pins`：nginx 安全头继承、action 钉版可解析性；
- `pnpm docs:check` / `api:check` / `i18n:check`：文档链接与锚点、端点清单漂移、三端词典对称；
- `pnpm tokens:check`：小程序令牌必须与 shared 种子同源；
- `pnpm workflows:check`：CI workflow 自身的结构合法性（缺 runs-on、needs 拼错、无超时都会让 CI 静默不跑）；
- `pnpm env:check`：部署清单（.env.example / .env.monitoring.example）与代码读取的变量双向一致；
- `pnpm verify`：把上面这些串成一条命令，与 CI 的 lint job 同源——本地能跑完的才算规矩，否则只是愿望。

## 明确不做的事

看[路线图第 7 节「反路线」](roadmap.md)——那一节的存在就是为了挡住需求膨胀，
任何新增能力如果与它冲突，先改那份清单并说明理由，而不是绕过它。
