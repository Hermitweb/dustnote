# 更新日志

本项目所有显著变更记录于此。格式基于 [Keep a Changelog](https://keepachangelog.com/)，版本遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

### 计划中

- iOS 客户端正式构建（待 macOS 硬件 + Apple 签名）
- macOS 桌面 vpk pack 实测（待 macOS 硬件）
- CRDT 实时协同编辑
- AI 助手（写作润色、自动标签、问答）
- 双向链接 / 知识图谱
- 插件系统

## [2.2.0] - 2026-07-30

### 新增 — 生产就绪度补强（GDPR + 设备管理 + 安全加固）

本次发布聚焦"可上线生产产品"视角，补齐合规、安全、运维三类缺口。详见 [docs/production-readiness-audit.md](./docs/production-readiness-audit.md)。

#### 1. GDPR 合规

- **账户删除（Article 17 被遗忘权）**：[server/src/routes/account.ts](./server/src/routes/account.ts) 实现 `DELETE /api/v1/account`，事务级联删除用户全部数据（users / devices / notes / note_versions / folders / tags / note_tags / shares / preferences / templates），audit_log 保留以符合合规审计要求
- **数据导出（Article 20 数据可携带权）**：`GET /api/v1/account/export` 导出账户全部元数据 + 密文笔记，支持客户端解密后迁移

#### 2. 设备管理

- [server/src/routes/devices.ts](./server/src/routes/devices.ts) 新增三端点：
  - `GET /api/v1/devices` — 列出当前用户所有登录设备
  - `DELETE /api/v1/devices/:id` — 吊销指定设备（清空 refresh_token_hash）
  - `DELETE /api/v1/devices` — 登出其他设备（一键吊销除当前外全部）
- 路由挂载于 [server/src/app.ts](./server/src/app.ts)，复用 authMiddleware

#### 3. Nginx 生产加固

- [deploy/nginx.conf](./deploy/nginx.conf) 新增：
  - HSTS（max-age=63072000; includeSubDomains; preload）
  - 严格 CSP（default-src 'self'; object-src 'none'; frame-ancestors 'none'）
  - X-Frame-Options: DENY
  - Permissions-Policy（camera/microphone/geolocation 全禁）
  - API 速率限制（20r/s + burst 30）
  - TLS 1.3 only + 现代密码套件

#### 4. i18n 补齐

- [web/src/components/ForceUpdateOverlay.tsx](./web/src/components/ForceUpdateOverlay.tsx) 硬编码中文改用 `useTranslation`
- [web/src/lib/i18n.ts](./web/src/lib/i18n.ts) 新增 `force_update_title` / `force_update_hint` / `banner_subtitle` / `common.loading` 中英双语
- i18n 校验脚本通过：284 keys 全部已定义

#### 5. 审计报告

- 新增 [docs/production-readiness-audit.md](./docs/production-readiness-audit.md)：按 production-checklist 7 维度全面评估，标注代码层就绪度 80%、基础设施就绪度 40%，列出 v2.2.1+ 改进路线

### 修复

- **i18n 检查脚本绕过**：移除 i18n.ts 中行内 `//` 注释（check-i18n.mjs 不跳过注释会导致 key 误判缺失）

### 版本同步

- 全部 package.json / Cargo.toml / tauri.conf.json / build.gradle / env / release.yml / docker-compose / .env.example 同步至 2.2.0
- Android versionCode 9→10
- server/src/env.ts 默认版本号 2.1.1 → 2.2.0
- docker-compose.yml fallback 版本号 2.0.1 → 2.2.0

### 已知缺口（v2.2.1+ 跟进）

- 设备管理 / 账户删除的前端 UI 尚未对接（API 已就绪）
- mobile / miniprogram 端功能未对齐 web（搜索 / 分享创建 / 导入导出 / 历史 / 模板）
- SBOM / Dependabot / CodeQL 未集成
- Lighthouse 性能基线未建立
- Playwright E2E 测试未集成

## [2.1.3] - 2026-07-30

### 修复 — Android

- **react-native-quick-crypto 0.7+ 导入路径变更**：移除 `/auto` 子路径，改用 `import { install } from 'react-native-quick-crypto'; install()`，需独立 side-effect 文件先于 App 加载（ES module imports hoisting）
- **Gradle 签名配置健壮性**：`build.gradle` 改用 `.length() > 0` 校验 keystore 路径 + `signingConfigs.findByName('release')` 安全查找，避免空字符串注入导致 `file("")` 异常

## [2.1.2] - 2026-07-29

### 修复 — Android

- 修复 release keystore 解码与 gradle 环境变量注入流程

## [2.1.1] - 2026-07-29

### 修复

#### 安全加固
- **JWT 非对称签名**：服务端 JWT 从 HS256 对称密钥迁移到 EdDSA / Ed25519 非对称签名，降低密钥泄露风险；保留双算法向后兼容（[server/src/auth/jwt.ts](./server/src/auth/jwt.ts)）
- **E2EE 端到端加密分享**：分享内容以 AES-256-GCM 加密上传，shareKey 由 masterKey 包装，仅持密钥链接可本地解密（[server/src/routes/shares.ts](./server/src/routes/shares.ts)、[web/src/components/SharesManager.tsx](./web/src/components/SharesManager.tsx)）
- **分享密码 POST Body 传输**：分享密码从查询字符串改为 POST body，避免 URL 泄露（[server/src/routes/shares.ts](./server/src/routes/shares.ts)）
- **分享失败锁定**：单分享连续失败 6 次后锁定 15 分钟，防暴力破解
- **AES-GCM AAD 绑定**：加密上下文绑定 AAD，防跨上下文重放
- **密钥使用后清零**：敏感密钥用后立即 zeroize
- **XSS 防护**：新增 sanitize-html 白名单净化，HTML 预览与分享渲染均经 DOMParser 过滤（[web/src/lib/sanitize-html.ts](./web/src/lib/sanitize-html.ts)）

#### 移动端增强
- **i18n 国际化**：移动端接入 react-i18next，支持中英双语 + AsyncStorage 持久化（[mobile/src/lib/i18n.ts](./mobile/src/lib/i18n.ts)）
- **笔记模板**：编辑页新增模板选择入口
- **版本历史**：编辑页新增历史版本查看与恢复入口

#### Web 质量
- **密码强度计**：实时评估密码强度（长度/字符类型/弱口令黑名单）
- **Toast 通知**：统一用户操作反馈
- **无障碍**：分享管理对话框增加 ARIA 语义、焦点陷阱、Esc 关闭
- **移动端响应式**：侧边栏适配窄屏

#### 构建 / 类型修复
- **jest-dom 类型声明**：补充 `toBeInTheDocument` / `toHaveAttribute` 匹配器编译期类型，修复 `tsc -b --noEmit`（[web/src/test/jest-dom.d.ts](./web/src/test/jest-dom.d.ts)）
- **Tauri 防截屏方法名**：`set_protected` → `set_content_protected`（Tauri 2.11 实际 API），修复 cargo check（[desktop/src-tauri/src/lib.rs](./desktop/src-tauri/src/lib.rs)）
- **Tauri 权限名**：`core:window:allow-set-protected` → `core:window:allow-set-content-protected`（[desktop/src-tauri/capabilities/default.json](./desktop/src-tauri/capabilities/default.json)）
- **Android 签名证书**：生成 RSA 2048 / 10000 天有效期 release keystore，写入 build.gradle 签名配置 + CI Secrets 解码流程（[docs/android-signing.md](./docs/android-signing.md)）

### 测试

- shared: 57 tests（+8 wrapKey/unwrapKey、AAD、zeroize）
- server: 71 tests（+10 EdDSA JWT、E2EE shares）
- web: 67 tests（+19 SharesManager、NoteHistoryDialog 组件测试）
- desktop: cargo check 通过

### 版本同步

全部 package.json / Cargo.toml / tauri.conf.json / build.gradle / env / release.yml / update-manifest 同步至 2.1.1

## [2.1.0] - 2026-07-29

### 新增 — P1 功能补齐（8 项）

v2.1.0 落实 production-readiness.md 中全部 8 项代码层 P1 任务，让产品达到「可日常使用」的完整度。

#### 1. i18n 国际化框架接入

- [web/src/lib/i18n.ts](./web/src/lib/i18n.ts)：基于 react-i18next 的中英双语框架，覆盖 auth/sidebar/editor/settings/mode_select/import_export/public_share/admin/cheatsheet/history/templates 命名空间
- 语言切换持久化到 localStorage，设置页提供中英切换

#### 2. 键盘快捷键 Cheatsheet（F1 唤起）

- [web/src/components/Cheatsheet.tsx](./web/src/components/Cheatsheet.tsx)：F1 全局唤起快捷键速查面板
- 覆盖新建/保存/搜索/侧边栏/设置/锁定等快捷键

#### 3. 错误监控接入（Sentry）

- [web/src/lib/sentry.ts](./web/src/lib/sentry.ts)：客户端 Sentry 初始化（DSN 可选）
- [server/src/sentry.ts](./server/src/sentry.ts)：服务端 Sentry 集成，适配 @sentry/node v10 的 `setupExpressErrorHandler` API
- 未配置 DSN 时为 no-op，不影响运行

#### 4. 移动端生物识别解锁

- [mobile/src/screens/StandaloneUnlockScreen.tsx](./mobile/src/screens/StandaloneUnlockScreen.tsx)：单机模式生物识别解锁
- 使用 react-native-keychain 缓存 masterKey，指纹/Face ID 解锁免输密码
- Keychain 不可用时降级为密码输入；MIUI 等设备 `canImplyAuthentication` 异常时 1.5s 超时保护

#### 5. 笔记历史版本管理

- [server/src/migrations.ts](./server/src/migrations.ts) id=9：note_versions 表迁移
- [server/src/routes/notes.ts](./server/src/routes/notes.ts)：历史版本 API（GET 列表 / GET 详情 / POST 恢复）
- [web/src/components/NoteHistoryDialog.tsx](./web/src/components/NoteHistoryDialog.tsx)：历史版本对话框（版本列表 + 预览 + 恢复）
- [shared/src/types.ts](./shared/src/types.ts)：NoteVersionMeta / NoteVersion 类型
- 服务端只存密文，解密预览在客户端完成

#### 6. 模板系统

- [server/src/migrations.ts](./server/src/migrations.ts) id=10：templates 表迁移 + 6 个预设模板 seed（空白/日记/会议/待办/阅读/项目）
- [server/src/routes/templates.ts](./server/src/routes/templates.ts)：模板 CRUD API（预设明文 + 自定义 E2EE 加密）
- [shared/src/templates.ts](./shared/src/templates.ts)：bundled 预设模板（单机模式可用）+ `fillTemplatePlaceholders` 占位符替换
- [web/src/components/TemplatePicker.tsx](./web/src/components/TemplatePicker.tsx)：模板选择对话框
- [web/src/components/Sidebar.tsx](./web/src/components/Sidebar.tsx)：侧栏新增「📋」模板按钮
- [web/src/components/Editor.tsx](./web/src/components/Editor.tsx)：编辑器新增「📋」存为模板按钮
- 预设模板：全用户共享，明文 Markdown；自定义模板：用户私有，masterKey 加密存储

#### 7. 全文搜索 v2（内存倒排索引）

- [web/src/lib/search.ts](./web/src/lib/search.ts)：SearchIndex 类（内存倒排索引 + Intl.Segmenter 中文分词 + 字段权重排序）
- [web/src/components/Sidebar.tsx](./web/src/components/Sidebar.tsx)：搜索改为索引查询，标题命中权重 > 标签 > 正文
- 搜索结果高亮：`highlightMatches` 函数将匹配 token 用 `<mark>` 包裹（XSS 安全）
- 增量更新：笔记变更时单条 reindex，无需全量重建
- [web/src/lib/search.test.ts](./web/src/lib/search.test.ts)：17 个测试用例覆盖分词/索引/搜索/高亮

#### 8. 桌面系统托盘 + 全局快捷键（v1.3 已交付，本次确认）

- [desktop/src-tauri/src/lib.rs](./desktop/src-tauri/src/lib.rs)：TrayIconBuilder + 全局快捷键 ⌘⇧M 唤起
- 单实例插件防止多窗口

### 修复

- **安卓端 ErrorBoundary 闪退**：SafeAreaView 必须在 SafeAreaProvider 内使用，ErrorBoundary 改用普通 View + paddingTop 手动留白
- **Windows 桌面右键菜单**：Rust eval + 前端 window/document 双重事件监听 + CSS user-select 三重防护，所有桌面环境禁用浏览器右键菜单
- **Tauri 2 编译错误**：WebviewWindow 无 init_script 方法，改用 `w.eval()` 注入 JS

### 安全

- v2 认证协议同步：masterKey 随机生成 + KEK 包装 + authKey 认证 + 10 位 Crockford Base32 恢复码
- E2EE 分享：shareKey 本地生成 + URL fragment 传递 + 服务端仅存密文
- XSS 防护：[web/src/lib/sanitize-html.ts](./web/src/lib/sanitize-html.ts) 白名单净化 + [deploy/nginx.conf](./deploy/nginx.conf) CSP 安全头
- 账号锁定：连续失败锁定 + IP 限流双重防护

### 版本号

- 全部 package.json / Cargo.toml / tauri.conf.json / env / Dockerfile / release.yml 同步至 2.1.0
- Android versionCode 5→6
- 数据库迁移版本 9→10

## [2.0.1] - 2026-07-27

### 修复 — 安卓端

- **闪退**：[MainActivity.kt](./mobile/android/app/src/main/java/com/dustnote/MainActivity.kt) `onCreate` 传 `null` 导致状态恢复崩溃 → 改传 `savedInstanceState`
- **应用名称**：[strings.xml](./mobile/android/app/src/main/res/values/strings.xml) `app_name` 为模板默认值 "Hello App Display Name" → "DustNote"
- **启动器图标**：adaptive icon foreground 错误引用 `@color`（颜色非合法 drawable）→ 新建 vector drawable（薄荷绿渐变 + 白色对勾，与 web/favicon 一致）；各密度 PNG 占位符重新生成
  - 新增 [ic_launcher_foreground.xml](./mobile/android/app/src/main/res/drawable/ic_launcher_foreground.xml)、[ic_launcher_background.xml](./mobile/android/app/src/main/res/drawable/ic_launcher_background.xml)
- **版本号**：Android `versionCode` 1→2，`versionName` "0.1.0"→"2.0.1"

### 修复 — Windows 桌面端

- **多窗口**：注册 `tauri-plugin-single-instance` 插件，第二实例唤起已有窗口而非开新窗口
- **卡在加载界面**（v1.0 起存在的问题）：
  - [store.ts](./web/src/lib/store.ts) `api()` 工厂硬编码 `'/api/v1'` → 改读 mode-store `serverUrl`，桌面联机模式可达服务器
  - `checkStatus()` 联机模式无错误处理，服务器不可达时 `authState` 停留 `'unknown'` 卡死 → 加 try/catch，失败时设 `authState='error'`
  - [App.tsx](./web/src/App.tsx) 新增 `error` 状态界面：显示错误信息 + 重试 / 重新选择模式按钮

## [2.0.0] - 2026-07-26

### 重大变更 — 单机/联机双模式架构

DustNote v2.0.0 引入**单机/联机双模式架构**，让客户端在完全没有服务器的情况下也能独立运行。详见 [standalone-mode.md](./.trae/documents/standalone-mode.md)。

#### 新增 — shared 层

- [shared/src/repository.ts](./shared/src/repository.ts)：DataRepository 接口契约（loadAll/createNote/updateNote/moveNote/deleteNote/permanentDeleteNote/emptyTrash/restoreNote/createFolder/deleteFolder/createTag/deleteTag/getPreferences/setPreferences/exportBackup/importBackup/clearBusinessData）
- [shared/src/local-auth.ts](./shared/src/local-auth.ts)：单机模式鉴权工具（setupLocalAuth/unlockLocalAuth/recoverLocalAuth）
- [shared/src/types.ts](./shared/src/types.ts)：新增 AppMode、NoteRow、Folder、Tag、Preferences、LocalAuthBlob、ModeState 类型
- **关键改进**：masterKey 随机生成（不从密码派生），双重包装（passwordWrappedMasterKey + wrappedMasterKey），recover 后 masterKey 保留（笔记密文无需重加密）

#### 新增 — Web 端

- [web/src/lib/mode-store.ts](./web/src/lib/mode-store.ts)：zustand 管理模式状态，持久化到 localStorage
- [web/src/lib/local-repo.ts](./web/src/lib/local-repo.ts)：IndexedDB 实现 DataRepository
- [web/src/lib/remote-repo.ts](./web/src/lib/remote-repo.ts)：封装 ApiClient 实现 DataRepository
- [web/src/lib/repository.ts](./web/src/lib/repository.ts)：工厂函数 createRepository
- [web/src/lib/local-auth-storage.ts](./web/src/lib/local-auth-storage.ts)：LocalAuthBlob + LocalLockoutState 持久化
- [web/src/components/ModeSelectDialog.tsx](./web/src/components/ModeSelectDialog.tsx)：首次启动选择 UI
- StandaloneSetupScreen / StandaloneUnlockScreen / StandaloneRecoverScreen

#### 新增 — Mobile 端

- [mobile/src/lib/mode-store.ts](./mobile/src/lib/mode-store.ts)：zustand + AsyncStorage 持久化
- [mobile/src/lib/local-repo.ts](./mobile/src/lib/local-repo.ts)：AsyncStorage 实现 DataRepository（项目未安装 MMKV，使用 AsyncStorage 替代）
- [mobile/src/lib/remote-repo.ts](./mobile/src/lib/remote-repo.ts)：封装 api 单例
- [mobile/src/lib/repository.ts](./mobile/src/lib/repository.ts)：工厂函数
- [mobile/src/lib/local-auth-storage.ts](./mobile/src/lib/local-auth-storage.ts)
- ModeSelectScreen / StandaloneSetupScreen / StandaloneUnlockScreen / StandaloneRecoverScreen

#### 新增 — Miniprogram 端

- 新增 4 个 lib 文件（mode-store、local-repo、remote-repo、local-auth-storage、repository）
- 新增 4 个页面（mode-select、standalone-setup、standalone-unlock、standalone-recover）
- 修改 [miniprogram/src/app.config.ts](./miniprogram/src/app.config.ts) 注册新页面

#### 修改 — Mobile 端

- [mobile/src/state/auth.ts](./mobile/src/state/auth.ts)：扩展支持双模式鉴权
- [mobile/src/screens/SettingsScreen.tsx](./mobile/src/screens/SettingsScreen.tsx)：实现导入/导出（基于 Repository.exportBackup/importBackup + RNFS + Share）、模式切换、版本号 2.0.0
- [mobile/src/api.ts](./mobile/src/api.ts)：**移除硬编码**，从 mode-store 动态读取 serverUrl
- [mobile/src/App.tsx](./mobile/src/App.tsx)：根据 mode 路由

#### 修改 — Web 端

- [web/src/lib/store.ts](./web/src/lib/store.ts)：支持双模式，添加 mode/repository/localAuthBlob/lockoutState 等
- [web/src/App.tsx](./web/src/App.tsx)：根据 mode 显示不同鉴权流程
- [web/src/lib/i18n.ts](./web/src/lib/i18n.ts)：添加 mode_select 和 settings.app_mode 翻译键
- [web/src/screens/PublicShareView.tsx](./web/src/screens/PublicShareView.tsx)：硬编码 '0.1.0' 改为 __APP_VERSION__

#### 修改 — Desktop 端

- [desktop/src-tauri/tauri.conf.json](./desktop/src-tauri/tauri.conf.json)、[Cargo.toml](./desktop/src-tauri/Cargo.toml)、[package.json](./desktop/package.json)：版本号 2.0.0
- Velopack 更新机制正常，GITHUB_REPO_URL = "https://github.com/Hermitweb/dustnote"

#### 修改 — Server 端

- [server/src/env.ts](./server/src/env.ts)：serverVersion/minClientVersion/recommendedClientVersion 默认 2.0.0
- [server/src/routes/health.ts](./server/src/routes/health.ts)：使用 config.serverVersion
- [server/src/services/update-manifest.ts](./server/src/services/update-manifest.ts)：miniprogram.version=2.0.0、minServerVersion=config.serverVersion
- [server/.env.example](./server/.env.example)、[.env.example](./.env.example)、[docker-compose.yml](./docker-compose.yml)、[deploy/README.md](./deploy/README.md)、[scripts/smoke-test.sh](./scripts/smoke-test.sh)：版本号同步

#### CI/Release 改造

- [.github/workflows/release.yml](./.github/workflows/release.yml) 改造：
  - 资产重命名（`DustNote-<Platform>-<Version>.<ext>`）
  - 三分区 Release body（客户端安装包/服务端部署/自动更新）
  - 新增 build-server-zip job
  - macOS/Linux 桌面构建 `continue-on-error: true`
  - create-release `if: always()`
  - iOS 构建跳过（硬件限制）
- 新增 [DEPLOY.md](./DEPLOY.md)：完整服务端部署文档（Docker Compose + 手动部署 + 反向代理 + HTTPS + 备份恢复 + 升级 + 故障排查）

### 文档

- 新增 [standalone-mode.md](./.trae/documents/standalone-mode.md)（单机模式完整说明）
- 更新 [PRD.md](./.trae/documents/PRD.md)：添加 v2.0.0 双模式需求章节
- 更新 [roadmap.md](./.trae/documents/roadmap.md)：新增 M8 里程碑（v2.0.0 双模式架构）
- 更新 [tech-architecture.md](./.trae/documents/tech-architecture.md)：添加数据访问层抽象、双模式架构、单机鉴权章节
- 更新 [data-flow.md](./.trae/documents/data-flow.md)：添加单机模式数据流、模式切换数据迁移流程
- 更新 [update-strategy.md](./.trae/documents/update-strategy.md)：添加 v2.0.0 资产命名约定、三分区 Release body、单机/联机更新策略
- 更新 [security.md](./.trae/documents/security.md)：添加单机模式安全模型章节（威胁模型、masterKey 双重包装、客户端锁定、与联机模式差异对比）
- 更新 [production-readiness.md](./.trae/documents/production-readiness.md)：版本号 v2.0.0、MMKV/AsyncStorage 选择说明、单机模式生产就绪检查项
- 更新 [v1.1-medium-low-priority.md](./.trae/documents/v1.1-medium-low-priority.md)：标注全部任务完成状态
- 更新 [integrate-velopack.md](./.trae/documents/integrate-velopack.md)：标注集成完成、添加 v2.0.0 Release 工作流改造说明
- 更新 [README.md](./README.md)：双模式介绍、快速开始（单机/联机）
- 更新 [docs/user-guide.md](./docs/user-guide.md)：模式选择、setup/unlock、CRUD、导入/导出、模式切换
- 更新 [docs/self-hosting.md](./docs/self-hosting.md)：链接到 DEPLOY.md
- 更新 [docs/compatibility-matrix.md](./docs/compatibility-matrix.md)：客户端 v2.0.0 ↔ 服务端 v2.0.0
- 更新 [docs/faq.md](./docs/faq.md)：单机数据丢失风险、模式切换注意事项、恢复码丢失

### 跳过项

| 跳过项                  | 原因                          | 影响                                            |
| ----------------------- | ----------------------------- | ----------------------------------------------- |
| iOS 构建                | 需 macOS + Xcode + Apple 签名 | iOS 无安装包；RN 代码已编写，未来可构建         |
| macOS 桌面 vpk pack 实测 | 需 macOS 硬件                 | release.yml 已有 `continue-on-error: true`      |

### 安全改进

- masterKey 随机生成 + 双重包装（passwordWrappedMasterKey + wrappedMasterKey）
- recover 后 masterKey 保留，笔记密文无需重加密
- 单机模式客户端锁定（6 次失败锁 15 分钟）
- Argon2id 参数（m=64MB, t=3, p=4）与联机模式一致

## [0.1.0] - 2026-06-27

### 新增

- 项目骨架与产品开发文档
- PRD、技术架构、主题系统、导入导出、安全、研发路线图文档
- Web 端 Vite + React + Tailwind 启动模板
- Tauri 桌面端项目结构
- React Native 移动端项目结构
- Taro 小程序项目结构
- Node.js + Express + SQLite 后端项目结构
- 端到端加密密钥层级方案
- 6 主题 × 2 模式完整色板
- 实时同步（WebSocket）协议定义

### 文档

- [PRD](./.trae/documents/PRD.md)
- [技术架构](./.trae/documents/tech-architecture.md)
- [主题系统](./.trae/documents/theme-system.md)
- [导入导出与分享](./.trae/documents/data-flow.md)
- [安全规范](./.trae/documents/security.md)
- [研发路线图](./.trae/documents/roadmap.md)
- [生产上线检查单](./.trae/documents/production-readiness.md)

[Unreleased]: https://github.com/Hermitweb/dustnote/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/Hermitweb/dustnote/releases/tag/v2.2.0
[2.1.3]: https://github.com/Hermitweb/dustnote/releases/tag/v2.1.3
[2.1.2]: https://github.com/Hermitweb/dustnote/releases/tag/v2.1.2
[2.1.1]: https://github.com/Hermitweb/dustnote/releases/tag/v2.1.1
[2.1.0]: https://github.com/Hermitweb/dustnote/releases/tag/v2.1.0
[2.0.1]: https://github.com/Hermitweb/dustnote/releases/tag/v2.0.1
[2.0.0]: https://github.com/Hermitweb/dustnote/releases/tag/v2.0.0
[0.1.0]: https://github.com/Hermitweb/dustnote/releases/tag/v0.1.0
