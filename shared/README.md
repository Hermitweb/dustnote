# shared · 跨端共享层

**一句话**：五端共用的契约与算法。这里改一行，五端都要重算——所以它只放
**纯函数与类型**，不放任何平台 API。

## 里面有什么

| 文件                             | 职责                                                                                | 谁在用                          |
| -------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| `crypto.ts`                      | 信封加解密（AES-256-GCM + AAD 绑定 `noteId‖userId`）、HKDF 分叉、PBKDF2/Argon2 参数 | 全端                            |
| `local-auth.ts`                  | 单机模式的本地主密码校验与锁定（6 次失败锁 15 分钟）                                | 全端                            |
| `repository.ts`                  | 仓库层接口：LocalRepository / RemoteRepository 共同契约                             | client-core、各端               |
| `api.ts`                         | 请求/响应类型与错误码常量                                                           | server、各端                    |
| `error-codes.ts`                 | 机器可读错误码的唯一定义处                                                          | 全端                            |
| `theme-seeds.ts`                 | **主题种子**（7 套皮肤 × 亮暗），派生语义色                                         | web、desktop、miniprogram、site |
| `theme-engine.ts`                | 种子 → CSS 变量的运行时应用；顺带清 stale 变量                                      | 各端                            |
| `time-format.ts`                 | 统一时间格式化（修 iOS/JSC 解析差异的根）                                           | 各端                            |
| `net-utils.ts`                   | 内网判定（允许 HTTP 回环/局域网的边界在这）                                         | 各端                            |
| `update-check.ts` / `version.ts` | 版本比较与强制升级判定                                                              | 各端                            |
| `migration.ts`                   | 数据/密钥格式迁移的共享步骤                                                         | 各端                            |
| `templates.ts`                   | 内置笔记模板                                                                        | 各端                            |
| `styles/tokens.css`              | **设计令牌唯一真源**（含极光与玻璃材质约束）                                        | web、site                       |
| `tailwind-colors.mjs`            | 语义色 → Tailwind 的映射，避免两端各抄一份                                          | web、site                       |

## 跑

从仓库根跑（推荐，走 turbo 缓存）：

```bash
pnpm --filter @dustnote/shared test         # vitest
pnpm --filter @dustnote/shared typecheck    # tsc --noEmit
pnpm --filter @dustnote/shared build        # 产出 dist/，供各端消费
```

改完至少跑一次 `pnpm verify`：它会连带跑各端测试，共享层的破坏通常先在下游暴露。

## 改动时的连带影响（必读）

- 改 `crypto.ts` 的任何参数（迭代次数、AAD 组成、HKDF info）＝**既有密文可能解不开**。
  这类改动必须在 `docs/adr/` 追加决策记录，写清兼容与迁移路径；
  `docs/roadmap.md` 的台账也要记。已上线的加密语义无法回退。
- 改 `theme-seeds.ts` 会被三处比对：`pnpm tokens:check`（小程序令牌）、
  `site/src/content.test.ts`（官网配色同源）、各端主题测试。
- 新增被跨包引用的文件（尤其 `styles/` 与 `.mjs`），
  **必须同步补 Dockerfile 的 COPY**——`pnpm docker:check` 会拦，
  但这条规矩的来历是 v2.5.46 升级现场连挂两次。
- 这里不放 `Buffer`/document`/wx.*` 等任一平台能力；
  需要平台差异时用注入（见 `crypto-backend.ts` 的做法，它在 client-core）。
