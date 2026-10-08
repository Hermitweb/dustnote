# scripts · 门禁与工程脚本

**一句话**：这个目录里的每个 `.mjs` 要么是一条门禁，要么是支撑发布的工具。
门禁的来历（哪次事故逼出来的）记在根目录 `CONTRIBUTING.md` 的门禁总表里。

## 门禁（失败即 exit 1，全部串进 `pnpm verify`）

| 脚本                         | 命令                               | 拦什么                                                     |
| ---------------------------- | ---------------------------------- | ---------------------------------------------------------- |
| `check-docs.mjs`             | `pnpm docs:check`                  | 文档死链、锚点无落点、孤儿文档                             |
| `check-env-vars.mjs`         | `pnpm env:check`                   | 部署清单与代码读取的变量双向不一致（主栈/监控栈分面）      |
| `check-workflows.mjs`        | `pnpm workflows:check`             | workflow 缺 runs-on、needs 拼错、无超时（GitHub 整份拒绝） |
| `check-action-pins.mjs`      | `pnpm action:pins`                 | 钉了不存在的 action SHA、注释版本与 SHA 不符               |
| `check-security-headers.mjs` | `pnpm security:headers`            | nginx add_header 不继承导致安全头静默消失                  |
| `check-docker-context.mjs`   | `pnpm docker:check`                | Dockerfile COPY 白名单漏掉跨包引用                         |
| `check-i18n.mjs`             | `pnpm i18n:check`                  | 三端词典键不齐、文案混进 emoji 图标                        |
| `check-error-text.mjs`       | `pnpm errtext:check`               | 三端裸 `err.message` 直出用户界面（绕过 errorText 分桶）   |
| `check-sw-version.mjs`       | `pnpm sw:check`                    | Service Worker 缓存版本没跟发布走                          |
| `check-readme-version.mjs`   | `pnpm readme:check`                | README 徽章版本与实际版本不符                              |
| `gen-api-inventory.mjs`      | `pnpm api:gen` / `api:check`       | 端点清单与真实路由漂移（清单是生成的）                     |
| `gen-mp-tokens.mjs`          | `pnpm tokens:gen` / `tokens:check` | 小程序令牌与 shared 种子漂移                               |

## 工具

| 脚本                                         | 用途                                           |
| -------------------------------------------- | ---------------------------------------------- |
| `bump-version.mjs`                           | 版本号多点同步（含 `site/package.json`）       |
| `status-probe.mjs` + `plaintext-targets.mjs` | 外部拨测，生成 `docs/status.md` 的状态段       |
| `alert-drill.sh`                             | 告警链路演练（`--smoke` 投合成告警，不动主栈） |
| `gen-third-party-notices.mjs`                | 生成 `THIRD_PARTY_NOTICES.md`                  |
| `pin-base-image-digests.mjs`                 | 把基础镜像钉到 digest                          |

## 两条硬规矩

1. **每条门禁都要有 `.test.mjs`**。跑法：`pnpm test:monitoring`（它扫 `scripts/*.test.mjs`）。
   守卫自己算错会同时制造噪音与漏报——这两天被反复教育。
2. **新写或改强一条门禁后，做变异验证**：把它守的东西故意改坏，确认变红，再改回来。
   一条从没红过的门禁，和没有门禁是一回事。

另外：脚本被测试 `import` 时不应有副作用——用

```js
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
```

把主流程收在直接执行闸门后面。`check-docs.mjs` 第一版就漏了这条，
测试一 import 它就扫全仓并打印。
