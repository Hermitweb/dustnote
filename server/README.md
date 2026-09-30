# server · 后端

**一句话**：Express + better-sqlite3 + WebSocket，**只存密文**。
服务端不持有明文，也不该有任何能读到明文的路径——这是整个安全模型的地基。

## 结构

| 目录/文件                                     | 职责                                                            |
| --------------------------------------------- | --------------------------------------------------------------- |
| `index.ts`                                    | 进程入口：加载配置 → 迁移 → 建 app → 起 WebSocket               |
| `app.ts`                                      | 中间件与路由挂载**顺序**（顺序即认证语义）                      |
| `env.ts` / `config.ts` / `config-validate.ts` | 环境变量集中读取、启动自检                                      |
| `db.ts` / `migrations.ts`                     | better-sqlite3 与迁移                                           |
| `auth/`                                       | `crypto-backend` 的服务端实现、字段级加密、口令校验、TOTP、锁定 |
| `middleware/`                                 | `authMiddleware`（含公开路径表）、客户端头校验、限流            |
| `routes/`                                     | 21 个路由文件，与 `docs/api.md` 的所属路由列一一对应            |
| `services/`                                   | 更新清单、备份、导出等跨路由逻辑                                |
| `metrics.ts`                                  | Prometheus 指标（默认关，`METRICS_ENABLED=true` 开）            |
| `sentry.ts` / `logger.ts`                     | 错误上报与结构化日志（脱敏）                                    |

## 跑

```bash
pnpm dev:server                # 本地：http://localhost:3210/api/v1/health
pnpm --filter @dustnote/server test
pnpm --filter @dustnote/server typecheck
```

## 端点清单从哪来

```bash
pnpm api:gen     # 从 app.ts 的挂载顺序 + authMiddleware 公开表生成 docs/api.md
pnpm api:check   # CI 用：清单与代码不一致即红
```

清单**不手写**。手写文档必然与路由漂移，而一份看起来完整的假 API 文档比没有更坏——
人会照它写客户端。

## 改这里的规矩

- **新路由必须在 `app.ts` 里挂载**，否则 `api:check` 看不见它（挂载顺序还决定要不要 token）。
- 读环境变量只在 `env.ts` 里集中读，且必须登记进 `.env.example`；
  `pnpm env:check` 双向核对（代码读了没登记、登记了没人读，都算不一致）。
- 查询参数走 zod schema。`req.query.x as string` 是谎言：
  `?x[]=a` 给数组、`?x[a]=1` 给对象（审计里真出过类型混淆）。
- 认证、加密、密钥管理相关改动需 2 人 review，见 `../CONTRIBUTING.md`。
- `config-validate.ts` 是启动前的自检闸门：宁可起不来，也不要带病服务。

## 已知边界

- 页面**不由 express 发出**：容器一体化，nginx 以静态目录吐出，express 只服务 `/api/`。
  所以安全头（CSP/HSTS）归 `deploy/nginx.conf` 管，由 `pnpm security:headers` 守继承不被打断。
- `docs/openapi.yaml` 只覆盖部分路径分组，缺口在 `docs/api.md` 里明写着，不假装完整。
