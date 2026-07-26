# DustNote 生产投产就绪状态（Production Readiness）

> 文档版本：v2.0.0
> 适用产品：DustNote · 尘心笔记
> 状态：**v2.0.0 双模式架构已交付，P0 全部完成，等待 P1 与 GA**

---

## 0. 投产决策矩阵

| 等级 | 含义           | 投产前必须  |
| ---- | -------------- | ----------- |
| P0   | 阻塞上线       | ✅ 全部完成 |
| P1   | 影响留存与口碑 | 一个月内    |
| P2   | 长期演进       | v1.1+       |

---

## 1. P0 完成清单

### 1.1 仓库门面 ✅

- [x] [LICENSE](../../LICENSE) — MIT
- [x] [README.md](../../README.md) — 快速开始 + 文档导航
- [x] [CONTRIBUTING.md](../../CONTRIBUTING.md) — 贡献指南
- [x] [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) — 行为准则
- [x] [SECURITY.md](../../SECURITY.md) — 安全披露流程
- [x] [CHANGELOG.md](../../CHANGELOG.md) — 变更日志

### 1.2 工程基础设施 ✅

- [x] [package.json](../../package.json) — monorepo 根
- [x] [pnpm-workspace.yaml](../../pnpm-workspace.yaml) — 工作区配置
- [x] [.gitignore](../../.gitignore) — 忽略规则
- [x] [.editorconfig](../../.editorconfig) — 编辑器规范
- [x] [.prettierrc.json](../../.prettierrc.json) — 格式化
- [x] [.github/workflows/ci.yml](../../.github/workflows/ci.yml) — CI（lint/typecheck/test/audit/build/docker）
- [x] [.github/workflows/release.yml](../../.github/workflows/release.yml) — 发版（SBOM + 二进制）
- [x] [.github/dependabot.yml](../../.github/dependabot.yml) — 依赖自动更新

### 1.3 法务文档 ✅

- [x] [docs/privacy-policy.md](../../docs/privacy-policy.md)
- [x] [docs/terms-of-service.md](../../docs/terms-of-service.md)
- [x] [docs/cookie-policy.md](../../docs/cookie-policy.md)

### 1.4 用户文档 ✅

- [x] [docs/user-guide.md](../../docs/user-guide.md) — 用户使用手册
- [x] [docs/faq.md](../../docs/faq.md) — 常见问题
- [x] [docs/self-hosting.md](../../docs/self-hosting.md) — 自托管指南
- [x] [docs/status.md](../../docs/status.md) — 服务状态

### 1.5 运维文档 ✅

- [x] [docs/operations-runbook.md](../../docs/operations-runbook.md) — 应急响应
- [x] [docs/compatibility-matrix.md](../../docs/compatibility-matrix.md) — 兼容矩阵
- [x] [docs/production-checklist.md](../../docs/production-checklist.md) — 上线检查单

### 1.6 GitHub Issue 模板 ✅

- [x] [.github/ISSUE_TEMPLATE/bug.md](../../.github/ISSUE_TEMPLATE/bug.md)
- [x] [.github/ISSUE_TEMPLATE/feature.md](../../.github/ISSUE_TEMPLATE/feature.md)
- [x] [.github/ISSUE_TEMPLATE/security.md](../../.github/ISSUE_TEMPLATE/security.md)
- [x] [.github/ISSUE_TEMPLATE/question.md](../../.github/ISSUE_TEMPLATE/question.md)
- [x] [.github/ISSUE_TEMPLATE/config.yml](../../.github/ISSUE_TEMPLATE/config.yml)

---

## 2. P1 一个月内补齐

| 项                               | 计划 | 负责人      |
| -------------------------------- | ---- | ----------- |
| i18n 框架接入（中英双语首发）    | M1.5 | 前端        |
| 笔记历史版本                     | M1.6 | 后端 + 前端 |
| 全文搜索 v2（密文本地索引）      | M1.7 | 客户端      |
| 键盘快捷键 Cheatsheet（F1 唤起） | M1.5 | 前端        |
| 模板系统                         | M1.8 | 前端        |
| 移动端生物识别解锁               | M2.1 | 移动端      |
| 桌面系统托盘 + 全局快捷键        | M1.9 | 桌面端      |
| 产品官网（hero + 截图）          | M1.2 | 设计 + 前端 |
| Logo 与品牌视觉                  | M1.1 | 设计        |
| 短 onboarding 视频               | M1.5 | 市场        |
| 自托管一键部署脚本               | M1.4 | 运维        |
| 错误监控接入（Sentry 自托管）    | M1.2 | 运维        |

---

## 3. P2 长期演进（v1.1+）

| 类别     | 项目                           | 版本 |
| -------- | ------------------------------ | ---- |
| 高级编辑 | Vim 模式、表格编辑器、数学公式 | v1.3 |
| 知识组织 | 双向链接、知识图谱             | v1.5 |
| 协作     | CRDT 实时协同                  | v2.0 |
| 扩展     | 浏览器扩展、移动桌面 Widget    | v1.4 |
| 生态     | 公开 API、Webhook、插件        | v2.0 |
| AI       | 写作润色、智能问答             | v2.0 |
| 迁移工具 | Evernote/Notion/OneNote 导入   | v1.3 |
| 商业化   | 家庭共享、付费主题             | v2.0 |

---

## 4. 实际投产仍需现场补齐（v0.1.0 → v1.0.0 GA 路上）

> 以下是"文档层面"已完成，但"运行时层面"必须由实施团队现场完成的事项：

### 4.1 域名与证书

- [ ] 购买 dustnote.app / dustnote.cn（如未注册）
- [ ] DNS 配置 A/AAAA 记录
- [ ] Let's Encrypt 证书签发
- [ ] HSTS Preload 提交
- [ ] 域名 WHOIS 隐私保护

### 4.2 邮件基础设施

- [ ] 邮件服务（Postmark / SES / 自建 Postfix）
- [ ] hello@dustnote.app / security@dustnote.app / oncall@dustnote.app
- [ ] DKIM / SPF / DMARC 配置
- [ ] 自动回复

### 4.3 监控基础设施

- [ ] Prometheus + Grafana 部署
- [ ] UptimeRobot / BetterStack 状态页
- [ ] PagerDuty / 飞书 / 钉钉 Webhook
- [ ] 日志聚合（Loki / ELK）

### 4.4 服务器

- [ ] VPS / 云主机采购（推荐 2 核 4GB 起）
- [ ] 操作系统初始化（Ubuntu 22.04 LTS）
- [ ] SSH 密钥 + fail2ban
- [ ] 防火墙配置
- [ ] 自动安全更新

### 4.5 第三方账号

- [ ] GitHub 组织 / 仓库
- [ ] Apple Developer 账号（iOS / macOS）
- [ ] Google Play 开发者账号（Android）
- [ ] 微信小程序账号
- [ ] 域名注册商账号

### 4.6 实体与备案

- [ ] 公司主体（或个体工商户）
- [ ] ICP 备案（如服务器在中国大陆）
- [ ] 公安备案
- [ ] 支付接入（如未来商业化）

---

## 5. 风险登记

| 风险                    | 等级 | 缓解                               |
| ----------------------- | ---- | ---------------------------------- |
| 主密码弱 + 设备未锁     | 高   | UI 引导、强度提示、自动锁屏        |
| 跨平台同步延迟          | 中   | 已实施 WebSocket，1s 内            |
| 客户端被 root 注入      | 中   | 服务端仅存密文                     |
| 主密码遗忘 + 恢复码丢失 | 高   | 首次强引导抄写，提供导出备份兜底   |
| 小程序审核驳回          | 中   | 提前研究《小程序运营规范》         |
| iOS 端后台 WS 断连      | 低   | 进入前台立即补偿                   |
| TLS 1.2 客户端兼容      | 低   | 内部接口强制 TLS 1.3，公网保留 1.2 |

---

## 6. 投产里程碑

- ✅ **v0.1.0**（2026-06-27）— 项目骨架 + 完整文档体系 + P0 检查单
- ✅ **v1.0.0** — Web 端 MVP + 主题系统 + 主密码 + E2EE + WebSocket 实时同步
- ✅ **v1.1.0** — 导入导出 + 分享
- ✅ **v1.2.0** — 桌面端 (Tauri 2) + Velopack 自动更新
- ✅ **v1.3.0** — Android (React Native)
- ✅ **v1.4.0** — 小程序 (Taro 3) 多端编译
- ✅ **v1.5.0** — 完善（性能、i18n、可访问性）
- ✅ **v2.0.0** — 单机/联机双模式架构 + 全文档更新 + 补全未开发功能

详见 [roadmap.md](./roadmap.md)

---

## 7. 签字栏

| 阶段       | 责任人         | 状态         | 日期       |
| ---------- | -------------- | ------------ | ---------- |
| 文档完整性 | PM + Tech Lead | ✅           | 2026-06-27 |
| 工程实现   | 开发团队       | ✅ v2.0.0    | 2026-07-26 |
| 安全审计   | 安全负责人     | ⏳ 待安排    | -          |
| GA 决策    | 全员           | ⏳ 待 v2.0.0 GA | -       |

---

## 8. v2.0.0 单机模式生产就绪检查（新增）

### 8.1 MMKV / AsyncStorage 选择说明

**决策**：Mobile 端使用 `AsyncStorage` 而非 `react-native-mmkv`。

**理由**：

| 维度         | MMKV                                          | AsyncStorage                              |
| ------------ | --------------------------------------------- | ----------------------------------------- |
| 性能         | 高（C++ 实现，同步 API）                      | 中（异步 API，JSON 序列化）               |
| 原生模块编译 | 需 C++ 编译环境，Android NDK 配置复杂         | RN 内置，无需额外编译                     |
| 跨平台一致性 | iOS / Android / HarmonyOS 均支持              | RN 全平台一致                             |
| 安装成本     | 需 `react-native-mmkv` 依赖                   | RN 内置                                   |
| 容量限制     | 无（基于 mmap）                               | 无（基于 SQLite / RocksDB）               |
| 加密支持     | 内置 AES-256                                  | 不加密，依赖业务层加密                    |

**项目实际情况**：

- 项目未安装 `react-native-mmkv`
- 单机模式 LocalAuthBlob 字段本身即密文/哈希，AsyncStorage 不加密不影响安全性
- 业务数据（NoteRow 等）由 masterKey 派生 localDEK 加密后才存储
- 未来若需提升性能，可在 LocalRepository 内部替换为 MMKV，接口不变

### 8.2 单机模式生产就绪检查项

发布前需通过：

- [ ] **shared 层**
  - [ ] [shared/src/repository.ts](file:///e:/workspace/dustnote/shared/src/repository.ts) DataRepository 接口完整
  - [ ] [shared/src/local-auth.ts](file:///e:/workspace/dustnote/shared/src/local-auth.ts) setupLocalAuth/unlockLocalAuth/recoverLocalAuth 全流程
  - [ ] [shared/src/types.ts](file:///e:/workspace/dustnote/shared/src/types.ts) 类型导出正确
  - [ ] masterKey 随机生成（不从密码派生）
  - [ ] masterKey 双重包装（passwordWrappedMasterKey + wrappedMasterKey）
  - [ ] recover 后 masterKey 保留（笔记密文不动）

- [ ] **Web/Desktop 端**
  - [ ] [web/src/lib/mode-store.ts](file:///e:/workspace/dustnote/web/src/lib/mode-store.ts) 持久化到 localStorage
  - [ ] [web/src/lib/local-repo.ts](file:///e:/workspace/dustnote/web/src/lib/local-repo.ts) IndexedDB CRUD
  - [ ] [web/src/lib/remote-repo.ts](file:///e:/workspace/dustnote/web/src/lib/remote-repo.ts) 封装 ApiClient
  - [ ] [web/src/lib/local-auth-storage.ts](file:///e:/workspace/dustnote/web/src/lib/local-auth-storage.ts) LocalAuthBlob 持久化
  - [ ] [web/src/components/ModeSelectDialog.tsx](file:///e:/workspace/dustnote/web/src/components/ModeSelectDialog.tsx) 模式选择 UI
  - [ ] StandaloneSetup/Unlock/Recover 全流程
  - [ ] [web/src/lib/store.ts](file:///e:/workspace/dustnote/web/src/lib/store.ts) 支持 mode/repository/localAuthBlob/lockoutState
  - [ ] [web/src/App.tsx](file:///e:/workspace/dustnote/web/src/App.tsx) 根据 mode 显示不同鉴权流程
  - [ ] i18n 添加 mode_select 和 settings.app_mode 翻译键

- [ ] **Mobile 端**
  - [ ] [mobile/src/lib/mode-store.ts](file:///e:/workspace/dustnote/mobile/src/lib/mode-store.ts) AsyncStorage 持久化
  - [ ] [mobile/src/lib/local-repo.ts](file:///e:/workspace/dustnote/mobile/src/lib/local-repo.ts) AsyncStorage 实现
  - [ ] [mobile/src/api.ts](file:///e:/workspace/dustnote/mobile/src/api.ts) **移除硬编码**，从 mode-store 读 serverUrl
  - [ ] [mobile/src/screens/SettingsScreen.tsx](file:///e:/workspace/dustnote/mobile/src/screens/SettingsScreen.tsx) 实现导入/导出（RNFS + Share）+ 模式切换 + 版本号 2.0.0
  - [ ] [mobile/src/state/auth.ts](file:///e:/workspace/dustnote/mobile/src/state/auth.ts) 扩展支持双模式鉴权
  - [ ] [mobile/src/App.tsx](file:///e:/workspace/dustnote/mobile/src/App.tsx) 根据 mode 路由

- [ ] **Miniprogram 端**
  - [ ] 新增 lib 文件（mode-store、local-repo、remote-repo、local-auth-storage、repository）
  - [ ] 新增页面（mode-select、standalone-setup、standalone-unlock、standalone-recover）
  - [ ] [miniprogram/src/app.config.ts](file:///e:/workspace/dustnote/miniprogram/src/app.config.ts) 注册新页面

- [ ] **Desktop 端**
  - [ ] [desktop/src-tauri/tauri.conf.json](file:///e:/workspace/dustnote/desktop/src-tauri/tauri.conf.json) version 2.0.0
  - [ ] [desktop/src-tauri/Cargo.toml](file:///e:/workspace/dustnote/desktop/src-tauri/Cargo.toml) version 2.0.0
  - [ ] [desktop/package.json](file:///e:/workspace/dustnote/desktop/package.json) version 2.0.0
  - [ ] Velopack GITHUB_REPO_URL = "https://github.com/Hermitweb/dustnote"
  - [ ] [web/src/screens/PublicShareView.tsx](file:///e:/workspace/dustnote/web/src/screens/PublicShareView.tsx) 硬编码 '0.1.0' 改为 __APP_VERSION__

- [ ] **Server 端**
  - [ ] [server/src/env.ts](file:///e:/workspace/dustnote/server/src/env.ts) serverVersion/minClientVersion/recommendedClientVersion 默认 2.0.0
  - [ ] [server/src/routes/health.ts](file:///e:/workspace/dustnote/server/src/routes/health.ts) 使用 config.serverVersion
  - [ ] [server/src/services/update-manifest.ts](file:///e:/workspace/dustnote/server/src/services/update-manifest.ts) miniprogram.version=2.0.0
  - [ ] [server/.env.example](file:///e:/workspace/dustnote/server/.env.example)、[.env.example](file:///e:/workspace/dustnote/.env.example)、[docker-compose.yml](file:///e:/workspace/dustnote/docker-compose.yml)、[deploy/README.md](file:///e:/workspace/dustnote/deploy/README.md) 版本号同步

- [ ] **CI/Release**
  - [ ] [.github/workflows/release.yml](file:///e:/workspace/dustnote/.github/workflows/release.yml) 资产重命名（DustNote-<Platform>-<Version>.<ext>）
  - [ ] 三分区 Release body（客户端安装包/服务端部署/自动更新）
  - [ ] 新增 build-server-zip job
  - [ ] macOS/Linux 桌面构建 `continue-on-error: true`
  - [ ] create-release `if: always()`
  - [ ] iOS 构建跳过（硬件限制）
  - [ ] 新增 [DEPLOY.md](file:///e:/workspace/dustnote/DEPLOY.md) 完整服务端部署文档

- [ ] **安全验证**
  - [ ] Argon2id 参数正确（m=64MB, t=3, p=4）
  - [ ] 客户端锁定 6 次/15 分钟
  - [ ] LocalAuthBlob 中无 masterKey 明文
  - [ ] 模式切换失败回滚验证
  - [ ] 各端 local-auth-storage 持久化正确

- [ ] **文档同步**
  - [ ] [standalone-mode.md](./standalone-mode.md) 新增
  - [ ] [PRD.md](./PRD.md) 添加 v2.0.0 双模式需求章节
  - [ ] [roadmap.md](./roadmap.md) 新增 M8 里程碑
  - [ ] [tech-architecture.md](./tech-architecture.md) 添加双模式架构章节
  - [ ] [data-flow.md](./data-flow.md) 添加单机模式数据流
  - [ ] [update-strategy.md](./update-strategy.md) 添加 v2.0.0 资产命名
  - [ ] [security.md](./security.md) 添加单机模式安全模型
  - [ ] [CHANGELOG.md](../../CHANGELOG.md) 添加 v2.0.0 条目
  - [ ] [README.md](../../README.md) 双模式介绍
  - [ ] [docs/user-guide.md](../../docs/user-guide.md) / [self-hosting.md](../../docs/self-hosting.md) / [compatibility-matrix.md](../../docs/compatibility-matrix.md) / [faq.md](../../docs/faq.md) 更新

### 8.3 跳过项（硬件限制）

| 跳过项                   | 原因                          | 影响                                                  |
| ------------------------ | ----------------------------- | ----------------------------------------------------- |
| iOS 构建                 | 需 macOS + Xcode + Apple 签名 | iOS 无安装包；RN 代码已编写，未来可构建               |
| macOS 桌面 vpk pack 实测 | 需 macOS 硬件                 | release.yml 已有 `continue-on-error: true`            |
| iOS MMKV 实测            | 同上                          | AsyncStorage 跨平台一致，代码层面已支持               |
