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

[Unreleased]: https://github.com/Hermitweb/dustnote/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/Hermitweb/dustnote/releases/tag/v2.0.0
[0.1.0]: https://github.com/Hermitweb/dustnote/releases/tag/v0.1.0
