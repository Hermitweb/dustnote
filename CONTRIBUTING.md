# 贡献指南

这份文档不只讲「怎么提 PR」，更讲**这里的东西为什么会悄悄烂掉、以及我们用哪条门禁拦它**——
本项目的大部分规矩是被真实事故逼出来的，不是预防性装饰。

先读：[Code of Conduct](./CODE_OF_CONDUCT.md) · [安全策略](./SECURITY.md) · [文档索引](./docs/README.md) · [架构总览](./docs/architecture.md) · [UI 优化方案](./docs/ui-optimization.md)

## 十分钟上手

```bash
# 环境：Node 20 / 22 / 24 LTS + pnpm 9.x
# Rust 仅桌面端需要，Android Studio 仅移动端，微信开发者工具仅小程序
pnpm install
pnpm dev        # 后端 :3210 + Web :5173
pnpm verify     # 本地跑完 CI 的全部门禁，提交前必须绿
```

`pnpm verify` 与 CI 的 lint job 是同一套命令，不是「本地宽松、CI 严格」。
若你发现某条门禁只在 CI 里跑、本地没有，那是漏洞：补进 `verify`，并写进下面的门禁表。

E2E 用根脚本跑：`pnpm test:e2e`（默认配置，CI 同款）；本机浏览器走
`pnpm test:e2e:local`（`playwright.local.config.ts` 已被 gitignore，不进 CI）。
发版升版本用 `pnpm bump`（= `node scripts/bump-version.mjs`，同步 26 处版本位点并自检残留）。

## 门禁总表（以及它们各自的那次事故）

| 命令                    | 拦的是什么                                                            | 由来                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`        | 跨包类型漂移                                                          | `shared/` 改一处，五端都要重算                                                                                                                            |
| `pnpm lint`             | 风格与危险写法                                                        | —                                                                                                                                                         |
| `pnpm lint:scripts`     | 门禁脚本自己写错                                                      | 守卫也得有人守                                                                                                                                            |
| `pnpm format:check`     | 格式漂移                                                              | 生成物（`docs/api.md`、`docs/status.md`）进 `.prettierignore`，否则与 prettier 互打：格式化即漂移                                                         |
| `pnpm test`             | 单测 + 覆盖率阈值                                                     | 阈值 CI 强制，不允许为变绿下调                                                                                                                            |
| `pnpm test:monitoring`  | 告警桥、拨测、nginx 守卫、action 钉版守卫的自测                       | 监控系统自己也得被监控                                                                                                                                    |
| `pnpm docker:check`     | Dockerfile `COPY` 白名单漏文件；compose 里同一容器端口的重复/互斥绑定 | 前者：v2.5.46 升级现场连挂两次，CI 与本地构建全绿——它们用完整源树。后者：v2.5.47 包内 8080 被声明两次（回环 + 0.0.0.0），`up -d` 必失败——只有真部署才现形 |
| `pnpm tokens:check`     | 小程序令牌与 `shared` 设计令牌漂移                                    | 小程序曾自己抄一份色值，改主题只改一半                                                                                                                    |
| `pnpm security:headers` | nginx `add_header` 不继承，整套安全头静默消失                         | 线上实测 `/api/`、`/metrics` 丢了 CSP                                                                                                                     |
| `pnpm action:pins`      | 钉了不存在、或与注释版本不符的 action SHA                             | nightly 拨测因假 SHA 静默失效，6 次排期全没跑                                                                                                             |
| `pnpm docs:check`       | 文档死链、锚点无落点、孤儿文档                                        | 首跑揪出 67 处，18 条指向早已删除的 `.trae/documents/`                                                                                                    |
| `pnpm env:check`        | 部署清单与代码读取的变量双向不一致（主栈 / 监控栈分面各查各的）       | 少登记一个变量的后果不是构建失败，而是备份写到没挂载的目录、字段加密悄悄回退                                                                              |
| `pnpm workflows:check`  | workflow 缺 runs-on、needs 拼错、没有 timeout-minutes                 | 加 Pages job 时真的漏写过 runs-on——那会让整份 CI 静默不跑                                                                                                 |
| `pnpm api:check`        | `docs/api.md` 与真实路由表漂移                                        | 清单从 `server/src/app.ts` 挂载顺序生成，不手抄                                                                                                           |
| `pnpm i18n:check`       | 三端词典键不齐、文案里混进 emoji 图标                                 | 见下方「图标规矩」                                                                                                                                        |
| `pnpm sw:check`         | Service Worker 缓存版本没跟着发布走                                   | 老 SW 兜住新页面 = 用户收不到更新                                                                                                                         |
| `pnpm readme:check`     | README 徽章版本与实际版本不符                                         | 版本号由 `scripts/bump-version.mjs` 多点同步，漏一处即拦                                                                                                  |
| `pnpm errtext:check`    | 三端把 `err.message` 裸直出用户界面（绕过 errorText 分桶）            | 同一类「英文技术黑话甩给用户」的回归在真机审计 2026-09-24、网页审计 2026-10-07 各复发一次，见下方「错误展示纪律」                                         |
| `pnpm build:site`       | 官网构建 + 内容守卫测试                                               | 官网写歪比没有官网更糟                                                                                                                                    |
| `nginx -t`（仅 CI）     | 部署配置语法                                                          | 容器是一体化的，配置写错就是下次升级起不来                                                                                                                |

## 两类本地跑不出来、必须靠门禁的问题

**一、Dockerfile 的 `COPY` 是白名单语义。**
在 `shared/` 下新增一个被跨包引用的文件（样式、令牌、构建配置），
本地构建和 CI 构建都不会暴露缺口——它们用完整源树；只有服务器上的现场构建会炸。
新增跨包引用必须同步补 `COPY`，`pnpm docker:check` 会双向校验（删掉 COPY 行即 FAIL）。

**二、构建全绿不等于界面正确。**
CSS 注释不嵌套，一个漏掉的闭合符能把紧随的整段声明吞进注释里，表现成「改了没生效」；
又如 390px 上文字重叠而 lint / test / build 全绿。
视觉改动必须看渲染结果（截图或 `pnpm dev`），不能只看 diff。

## 提 Issue

- **Bug 报告**：用 [Bug 模板](./.github/ISSUE_TEMPLATE/bug.md)，请带上版本号、平台、复现步骤；有截图更好——界面类问题「描述」和「截图」给的信息量差一个数量级。
- **功能建议**：用 [Feature 模板](./.github/ISSUE_TEMPLATE/feature.md)。我们会把它记进 [docs/roadmap.md](./docs/roadmap.md) 的台账，那里同时记「为什么不做」，不是所有建议都会被实现。
- **安全问题**：**不要**开公开 Issue，见 [SECURITY.md](./SECURITY.md)。

## 提 PR 的流程

1. 从 `main` 创建分支，前缀按用途：`feat/`、`fix/`、`docs/`、`ci/`、`refactor/`。
2. 提交遵循 [Conventional Commits](https://www.conventionalcommits.org/)：`feat: 新增导出 PDF 功能`、`fix: 修复主题切换闪烁`、`docs: 更新 README`。
   本仓库 commitlint 的两条实际约束：主题**不能以 PascalCase 词开头**（`CodeQL …` 会被 `subject-case` 拒，中文开头可过）；body 单行不超过 100 字符。
3. 目标分支为 `main`，合并由维护者确认。**不要自行直推 main**（紧急小修除外）。
4. 用户可见变更写入 [CHANGELOG.md](./CHANGELOG.md)。版本号不要手改：它由脚本在多处同步（根包、各端包、README 徽章、SW 版本、官网包），手改必漏点——`readme:check` 与 `sw:check` 就是为此存在。

## 文化：变异验证

新写一条门禁后，**把它守的东西故意改坏一次，确认测试变红**，再改回来。
一条从没红过的门禁，和没有门禁是一回事。本仓库至少三条门禁（`action:pins`、`docker:check`、官网配色同源）是在自我纠错时发现「原来它根本没在守」。

同理，不要为了变绿而放宽口径。确实需要放宽时，那一行旁边必须写清为什么这是对的
（例如 prettier 把长 meta 折行，于是 `name=` 与 `content=` 之间按空白匹配），否则宁可让它红着。

## 图标规矩（硬约束）

产品文案（i18n 串）里**不允许出现 emoji 形式的图标**。图标一律走 [docs/ui-icon-map.md](./docs/ui-icon-map.md) 的 SVG 体系，
`pnpm i18n:check` 把内嵌 emoji 上限设为 0，超了直接拦。原因：emoji 各平台字形不同、无法着色、随系统字体变化，等于把界面一致性交给别人。

## 设计系统与主题

- 令牌只有一处权威：`shared/styles/tokens.css`；语义色映射在 `shared/tailwind-colors.mjs`；主题种子在 `shared/src/theme-seeds.ts`。
- 文字不得直接压在极光层上（极光只画在 `body::before`），含文字的容器必须落在 `glass-1` / `glass-2` 或实色表面上。
- 底色挂在 `html` 而不是 `body`：`body` 一旦不透明就会盖掉极光（`z-index:-1`）。
- 官网 `site/` 复用同一套令牌与种子，`site/src/content.test.ts` 逐条比对，防止官网慢慢变成「另一个产品」。
- 新增主题需附预览截图；产品中文名以 `web/src/lib/i18n.ts` 的 `name` 为准，官网品牌串由测试钉住。

## 公共类型与跨端影响

修改 `shared/` 中的类型时，必须确认 server / web / desktop / mobile / miniprogram / client-core 的 build 与 test 都通过（`pnpm verify` 已覆盖）。
小程序侧令牌由 `pnpm tokens:gen` 生成，不要手改生成物。

## 安全敏感代码

涉及认证、加密、密钥管理的代码需 **2 人 review** 才能合并。
加密参数（KDF 迭代次数、AAD 绑定方式、HKDF 分叉）的改动必须在 [docs/adr/](./docs/adr/) 追加一条决策记录，写清兼容与迁移路径——
这类改动一旦上线就无法回退（老客户端还在用旧参数解密），所以「为什么这么选」必须留下。
安全问题请走 [SECURITY.md](./SECURITY.md)，**不要**开公开 Issue。

## 错误展示纪律（errorText）

用户可见的错误文案**一律经 `errorText(err)`**（web / mobile / miniprogram 各有
`src/lib/error-text.ts` 胶水，策略本体在 `@dustnote/shared` 的 `errorReason`）：
服务端错误码归语义桶取词典文案，无码异常透传原文，网络层错误归
「无法连接到服务器」——把 `err.message` 裸塞进 toast/弹窗，等于把
`signal is aborted without reason` 这类技术黑话甩给用户。展示点写 `errorText(err)`，
不要自己拼 `instanceof Error ? .message`。

两类豁免，各配一种标注（由 `pnpm errtext:check` 强制，见 scripts/check-error-text.mjs）：

- **分桶判定 / 诊断载荷**：`err.message` 只用于关键词归桶或进诊断队列，不直出 UI——
  在该行行尾或紧邻上一行写 `error-text-scope: classifier|payload`。
- **整文件性质使然**：崩溃兜底屏（展示 raw 是设计本身，且有 PROD/**DEV** 护栏）、
  上报载荷序列化——进脚本里的 ALLOWLIST，逐条附理由。撤豁免前先读理由。

## 文档

- 新增文档必须出现在 [docs/README.md](./docs/README.md) 索引里，否则 `pnpm docs:check` 以「孤儿文档」拦下——没被索引的文档等于不存在。
- 跨文档引用用相对链接；移动或改名文档时同步改引用（同样由 `docs:check` 守）。
- 官网内容改 `site/src/content.ts` 与 `site/index.html`：页面上每条事实性声明都有对应断言，改声明就改规格，二者不会各说一套。

## 项目结构

见 [README.md](./README.md#项目结构) 与 [docs/architecture.md](./docs/architecture.md)。
