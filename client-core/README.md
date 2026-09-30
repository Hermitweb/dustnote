# client-core · 三端共用的客户端内核

**一句话**：把「加密编排 + 仓库层 + 同步」从 Web/桌面/移动各写一遍，收成一份。
平台差异靠**注入**，不靠条件编译。

## 里面有什么

| 文件                                | 职责                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `crypto-backend.ts`                 | 加密后端接口：Web 用 WebCrypto，移动用原生 quick-crypto，测试用 @noble 纯 JS |
| `envelope.ts`                       | 密文信封的组装/拆解（含 AAD 与版本前缀）                                     |
| `mode-store.ts`                     | 单机 / 联机模式状态与迁移入口                                                |
| `remote-repository.ts`              | 联机仓库：API + 离线队列 + 冲突检测                                          |
| `offline-queue.ts`                  | 断网期间的写队列，恢复后按序重放                                             |
| `conflict.ts` / `conflict-store.ts` | 版本冲突的三方合并与待处理队列                                               |
| `sync-engine.ts`                    | WebSocket 增量同步编排（<1s 推送）                                           |
| `device-id.ts`                      | 稳定设备标识（服务端按它做设备管理）                                         |
| `i18n-runtime.ts`                   | 词典运行时装配（三端词典结构一致，内容各自维护）                             |

## 跑

```bash
pnpm --filter @dustnote/client-core test
pnpm --filter @dustnote/client-core typecheck
```

## 为什么它值得单独成一个包

改造前 Web / 桌面 / 移动各有一份同步与冲突逻辑，修一个 bug 要改三处，
而且三处的**边界条件本来就不一样**。收进来之后回归只需写一次。
详见 `docs/client-core-migration.md`。

## 改这里的规矩

- 任何平台能力都必须走注入参数；包里出现 `window`、`wx`、`navigator` 就是设计漏了。
- 仓库层契约变更要同步改 `shared/src/repository.ts`，否则三端类型会各自漂。
- 冲突合并语义（谁赢、怎么留证据）改动要在 `docs/adr/` 留一条。
