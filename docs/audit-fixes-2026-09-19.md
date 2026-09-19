# 审计修复执行记录与剩余项路线图（2026-09-19）

> 配套 `outputs/audit-report-2026-09-19.md` / `issues.json`。本文件在
> `fix/audit-2026-09-19` 分支上记录：哪些审计问题**已在本分支修复并提交**，
> 哪些**因需要外部资源 / 跨端构建验证 / 有意的产品取舍**而未盲改，附**可直接落地的
> 精确补丁**。逐项可审、可回滚。

## 一、已修复（本分支已提交）

| ID                 | 摘要                                                                                         | 涉及文件                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| PLAT-001(部分)     | 更新白名单去除"安装包自身 origin"自我授权恒真条目                                            | `desktop/src/lib/updater.ts`                                                            |
| PLAT-003(部分)     | 删除被 NSC 覆盖却触发 Play 误报的冗余 `usesCleartextTraffic`                                 | `mobile/android/app/src/main/AndroidManifest.xml`                                       |
| PLAT-005/006(部分) | web-clipper 去 `<all_urls>`→按需申请服务器 origin + 强制 https                               | `extensions/web-clipper/{manifest.json,popup.js}`                                       |
| LIFE-001 / SEC-002 | 部署默认生成 `BACKUP_ENCRYPTION_KEY` + `.env` 权限 600                                       | `deploy/deploy.sh`, `deploy/deploy.ps1`                                                 |
| DEP-002 / DEP-007  | tough-cookie CVE 修复、xmldom 旧名别名 override（lockfile 已刷新）                           | `package.json`, `pnpm-lock.yaml`                                                        |
| TEST-002           | CI 增覆盖率门禁步骤（`--coverage` 才让阈值真正生效）                                         | `.github/workflows/ci.yml`                                                              |
| TEST-003           | web 补 coverage 配置与阈值、`@vitest/coverage-v8`                                            | `web/{vitest.config.ts,package.json}`                                                   |
| TEST-001           | 3 个零测试包由静默 `echo [skip]` 改 CI `::warning::` 显式暴露                                | `desktop/mobile/miniprogram package.json`                                               |
| TEST-004           | bundle 预算改仅统计 JS 且超限 `exit 1` 阻断                                                  | `.github/workflows/ci.yml`                                                              |
| TEST-005           | 生产关闭 sourcemap，`.map` 不再随制品公开                                                    | `web/vite.config.ts`                                                                    |
| ARCH-005           | 补装 husky+commitlint+lint-staged，提交 pre-commit/commit-msg                                | `package.json`, `.husky/*`, `.commitlintrc.json`, `.lintstagedrc.json`                  |
| DATA-001           | 时间戳统一 ISO：写路径(建夹/PATCH偏好/注册/建标签)+ 幂等归一迁移 19（列缺失自动跳过）        | `server/src/routes/{folders,preferences,auth}.ts`, `server/src/migrations.ts`           |
| SEC-003            | crypto 头注释 Argon2id→PBKDF2 现状更正                                                       | `shared/src/crypto.ts`                                                                  |
| DOC-001            | 删除权三份表述统一为"立即不可逆"（对齐代码）                                                 | `docs/terms-of-service.md`                                                              |
| DOC-006            | 恢复码 12→10 位                                                                              | `docs/{terms-of-service,privacy-policy}.md`                                             |
| DOC-005            | 版本漂移（徽章 v2.5.40、installation-guide/DEPLOY 订正）+ 新增 CI 版本一致性校验             | `README.md`,`docs/installation-guide.md`,`DEPLOY.md`,`scripts/check-readme-version.mjs` |
| DOC-010/012        | CONTRIBUTING 目标分支 dev→main；README 安装脚本 dev/setup-and-fixes→main；CHANGELOG 断链修复 | `CONTRIBUTING.md`,`README.md`,`CHANGELOG.md`                                            |
| DOC-003            | 日期/排序硬编码 zh-CN→随 i18n.language                                                       | `web/src/components/{NoteHistoryDialog,SettingsDialog,SharesManager,Sidebar}.tsx`       |
| DOC-002            | 关于页链接隐私政策/ToS/第三方许可                                                            | `web/src/components/AboutDialog.tsx`                                                    |
| DOC-007            | 生成 THIRD_PARTY_NOTICES.md + 可复用脚本                                                     | `THIRD_PARTY_NOTICES.md`,`scripts/gen-third-party-notices.mjs`                          |
| ARCH-003           | 移除 2.2MB 无引用孤儿 `server/src/尘渊笔记.webp`                                             | git rm（历史可恢复）                                                                    |
| ARCH-004           | `.trae/` 取消追踪并纳入 .gitignore（与其余 agent 目录一致）                                  | `.gitignore`                                                                            |
| ARCH-009           | .gitignore 补 `screenshots/` `shoot.mjs`                                                     | `.gitignore`                                                                            |
| TEST-007           | Dockerfile 增 HEALTHCHECK                                                                    | `Dockerfile`                                                                            |
| PLAT-010(部分)     | build.gradle 去个人机绝对路径改相对                                                          | `mobile/android/app/build.gradle`                                                       |

验证：`pnpm typecheck` 全绿；`pnpm --filter @dustnote/server test` 106 通过（含迁移 19 运行）；`pnpm --filter @dustnote/web typecheck` 通过。

## 二、未盲改的项 —— 需外部资源（须你决策/采购）

**PLAT-002 / TEST-006 / LIFE-004：代码签名 + 校验和 + 公证 + provenance**
需要证书：Apple Developer（Developer ID Application + `notarytool`）与 Windows 代码签名证书（OV/EV）。落地补丁：

- macOS：release.yml 的 tauri 构建后 `tauri build --bundle dmg --sign "$APPLE_SIGNING_IDENTITY"` → `xcrun notarytool submit … --keychain-profile` → `xcrun stapler staple`。
- Windows：`bundle.windows.signCommand` 配 `signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /n "<CN>"`，证书经 CI secret 注入。
- 校验和：create-release 前
  ```yaml
  - name: Checksums
    run: |
      ( cd dist-artifacts && sha256sum * > SHA256SUMS.txt )
      # 或用 cosign/sigstore 对制品签名后一并 attach
  ```
  install.sh/ps1 下载后 `sha256sum -c` 校验再执行；引导 URL 用发布 tag 而非分支（见 DOC-012 已改 main，理想是 tag）。

**PLAT-004：小程序引导地址 `http://154.217.231.125:8080`**
需一个**已 ICP 备案的 HTTPS 域**并填入微信后台 request/socket/uploadFile/downloadFile 合法域名。落地：

- `miniprogram/src/lib/deployment.ts` 的 `DEPLOY_DEFAULT_SERVER_URL` 改为 `https://<备案域>`。
- `/config/server-endpoint` 响应体加服务端私钥签名、客户端内置公钥验签后才落库（防引导被 MITM 重定向到攻击者服务器）。
- 公网 IP 从源码移除（泄露基础设施）。

## 三、未盲改的项 —— 需跨端构建/真机验证（附精确补丁，勿在无法验证时合并）

**PLAT-005：web-clipper 明文直发破坏 E2EE**（已强制 https，但未加密内容）
扩展无解锁 UI，需引入与 web 端同源的密钥封装：popup 侧用 WebCrypto 以用户主密钥派生的 AEAD 密钥加密正文，再放入 `ciphertext`。工作量 M，需真机联调。

**PLAT-001(残余)：桌面更新信任根仍是服务器**
补 minisign：发布 `tauri signer generate`（私钥进 CI secret，公钥进 `tauri.conf.json > plugins.updater.pubkey` + 编译进 Rust 常量），Rust 下载后先验 minisign 签名再落盘；`allowed_prefixes` 改 Rust 硬编码常量；reqwest 用 `redirect::Policy::custom`，仅跟随仍匹配白名单 origin 的重定向（GitHub 需放行 `objects.githubusercontent.com`/`*.github.com`）。

**SEC-005 / CSP：`connect-src ... https: http:`**
联机服务器地址由用户配置，去裸 `https:` 会挡掉自托管。正确解：Tauri 运行时注入——在 setup 拿到 serverUrl 后 `webview_window.set_content_security_policy()` 拼接精确 origin；或构建期按部署 `--config` 注入。需桌面端联调验证。

**PLAT-003(残余)：Android 全域明文**
Google Play 接受需书面理由；若只局域网自托管，可用 `network_security_config` 拆 debug/release flavor 或产品内"仅信任我输入的地址"弹窗 + 证书固定文档。NSC 不支持 IP 段规则，无法零风险收紧而不破坏自托管 http。

**ARCH-001：desktop 经 `../../web/src` 相对导入**
把可共享 App shell 提为 `@dustnote/web` 的 `exports` 公共出口，desktop 用 `"@dustnote/web": "workspace:*"` 依赖并配 tsconfig `references`（让 turbo 依赖图正确）。跨包 API 设计 + desktop `build:web` 回归，需构建验证。

**ARCH-002：getDeviceId 四端漂移**
client-core 提供 `createDeviceIdStore(adapter)`（get-or-generate + 复用 `shared` 的 `randomUuid`），web/desktop/mobile/miniprogram 各注入存储适配器替换本地实现；小程序当前缺省返回 `''` 的撤销隐患随之消除。改动触及 RN/Taro 构建，需三端跑通。

**DATA-004：`users.totp_secret` 明文落库**
用启动时从独立于 JWT_SECRET 的 KEK 加密该列（迁移内对存量 TOTP 行 re-wrap），并让 config-validate 在 production 缺 `BACKUP_ENCRYPTION_KEY` 时 fail/warn 升级。触及 2FA 绑定/校验路径，需真机 2FA 回归。

**DOC-004 / DOC-010：a11y（表单标签、模态焦点陷阱）**

- 22 个 `<input>` 逐个补 `id`+`<label htmlFor>` 或 `aria-label`（SettingsDialog 等）。
- 模态引入 `react-focus-lock`（需新增 web 依赖）包裹 8 个 dialog：打开移焦首控件、关闭还焦触发元素、Tab 循环锁模态内。
  纯前端可本地验证，属工作量 M（面广）。

**DOC-008：未成年人年龄门**
首启加出生年份自证 + 低于阈值拦截/家长同意流程；阈值按目标市场取 13（含 EU 按成员国 13–16）与政策对齐。属产品功能，需设计确认。

**DOC-009 / ARCH-007 / ARCH-006：i18n 三端合并、巨型文件拆分**
抽公共词条到共享资源包（`shared/src/locales` 或新 `packages/i18n-assets`），web 先拆 1409 行 `i18n.ts` 为命名空间；设置页/首页按 slices 模式拆分。渐进式，建议配 `max-lines` 只对新代码强制。

**DEP-004 / DEP-006 / DEP-005：依赖大版本与供应链**

- 根治 request/swiper/vm2/tough-cookie 旧链需 **Taro 3.6 → 4** 专项升级；RN 0.74、ESLint 8→9 同理——均为大版本迁移，需完整回归，不在本分支盲升。
- Dependabot `ignore '*' semver-major` 改为**按包** ignore（让 taro/rn/eslint 至少能收到 major 升级 PR）。
- `onlyBuiltDependencies` allowlist：需先枚举 `better-sqlite3/esbuild/@swc/core/…` 全部需构建脚本的包并 `pnpm install` 验证不破坏原生构建后再启用（错误清单会导致安装/构建失败），故未直接开启。

**TEST-007/008：pin digest / Actions SHA**
跑仓库自带的 `pnpm pin-digests` 落地 `FROM …@sha256:`；关键 action（setup-node/upload-artifact/第三方 release action）pin 到 full commit SHA。需联网解析真实 digest/SHA，避免写错 SHA 直接卡死流水线。

**LIFE-008 / LIFE-009：强制升级出口 URL / 灰度默认**

- `version-check.ts:91,105` 硬编码 `https://dustnote.app/download` 改 `${config.webOrigin}/downloads/` 或新增 `DOWNLOAD_PAGE_URL`。
- `update-manifest.ts` `BETA_TRAFFIC_RATIO` 默认改 0（显式开启才切流），未配置通道版本回退 stable 而非 `0.1.0-beta.1` 占位。
  两处很小，但涉及线上升级行为，建议随一次带回归的版本一起发。

**DEP-001：lodash-es override `^4.18.1` 上游发布核验**
`npm view lodash-es versions` 人工确认 4.18.1 是否存在及来源可信；`Dockerfile` 的 `NPM_REGISTRY` build-arg 白名单化（仅 npmmirror 官方域）。确认非官方版本则按安全事件处理。
