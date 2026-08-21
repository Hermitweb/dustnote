# DustNote 开发计划与里程碑

> 文档版本：v2.0.0
> 适用产品：DustNote · 尘心笔记
> 目标读者：产品 / 开发 / 协作方

---

## 1. 总体规划

DustNote 采用"**Web 优先、桌面其次、移动再后、小程序最后**"的渐进交付策略。每个里程碑交付一个**可独立运行、可被用户感知价值**的版本。

| 阶段 | 版本   | 主题       | 目标                             | 状态      |
| ---- | ------ | ---------- | -------------------------------- | --------- |
| M0   | v0.1.0 | 项目骨架   | 仓库搭建、技术验证、主题系统跑通 | ✅ 已完成 |
| M1   | v1.0.0 | Web 端 MVP | 核心 CRUD + 主题 + 主密码        | ✅ 已完成 |
| M2   | v1.1.0 | 导入导出   | .txt / .md / .docx，多格式导出   | ✅ 已完成 |
| M3   | v1.2.0 | 分享       | 可控分享                         | ✅ 已完成 |
| M4   | v1.3.0 | 桌面端     | Tauri 打包                       | ✅ 已完成 |
| M5   | v1.4.0 | Android 端 | RN 打包                          | ✅ 已完成 |
| M6   | v1.5.0 | 小程序端   | Taro 多端编译                    | ✅ 已完成 |
| M7   | v1.6.0 | 完善       | 端到端加密、性能优化、协同草稿   | ✅ 已完成 |
| M8   | v2.0.0 | 双模式架构 | 单机/联机双模式 + 全文档更新     | ✅ 已完成 |

---

## 2. 里程碑详情

### M0 · v0.1.0 项目骨架 ✅

**周期**：T+0 ~ T+1 周

**交付**：

- monorepo 目录结构
- `shared/` 类型与主题 token
- `server/` 启动 + `/api/v1/health`
- `web/` Vite + React + Tailwind 启动
- CI：lint + typecheck + 单元测试

**验收**：

- `pnpm dev` 启动后端 + Web
- 主题切换 demo 页可工作
- 主题卡片展示 6 套主题

---

### M1 · v1.0.0 Web 端 MVP ✅

**周期**：T+1 ~ T+5 周

**交付功能**：

1. 主密码设置 / 解锁（Argon2id + 6 次失败锁定）
2. 笔记 CRUD（标题、Markdown 内容、标签、收藏、置顶）
3. 搜索（标题 / 内容 FTS5）
4. 回收站（30 天软删除）
5. 主题设置（6 主题 × 亮暗，字体，密度）
6. 偏好持久化（服务端 + 本地双写）
7. 基础响应式（桌面 + 移动）
8. 键盘快捷键（⌘N 新建、⌘S 保存、⌘K 搜索）
9. **实时同步 WebSocket 网关**（`ws` 库 + `/api/v1/sync/ws`）+ 5s 轮询降级
10. **端到端加密客户端实现**（Argon2id 派生 masterKey → AES-256-GCM 笔记加密）
11. **服务端密文存储**（note.title / content / tags 改为 ciphertext 列）
12. **生产环境基础设施**：Docker / Nginx / TLS 1.3 / 备份 cron / 监控接入

**客户端更新通道（Web 端先行）**：

13. [update-strategy.md §3](./update-strategy.md) `GET /api/v1/update-manifest` API + 中间件
14. Web 端启动时检测 + 软/硬提示 UI
15. 服务端 SQLite 迁移工具（[update-strategy.md §7.1](./update-strategy.md)）
16. E2EE 密钥双版本解密机制（[update-strategy.md §7.3](./update-strategy.md)）

**关键质量指标**：

- 首屏 LCP < 1.5s
- 编辑 60fps
- 主题切换 300ms 平滑
- WebSocket 通知 P95 < 300ms
- 全部主题对比度 AA 通过
- Web 打包 < 500KB gzip
- 渗透测试无 P0 / P1

**额外交付（GA 前）**：

- [docs/production-checklist.md](../../docs/production-checklist.md) 全部勾选
- 域名 / 证书 / 监控 / 告警 全部就位
- 至少 1 个真实用户的 dogfood 测试

---

### M2 · v1.1.0 导入导出 ✅

**周期**：T+5 ~ T+7 周

**交付功能**：

1. 拖拽 / 选择导入 .txt / .md / .docx
2. 导入预览 + 冲突策略
3. 导出 Markdown / HTML / PDF / JSON
4. 全量备份 ZIP
5. 批量操作（批量打标签、批量删除）

---

### M3 · v1.2.0 分享 ✅

**周期**：T+7 ~ T+9 周

**交付功能**：

1. 创建分享（可选密码、可选过期）
2. 分享管理（吊销、查看统计）
3. 公开分享页 `/s/:token`
4. 分享页 SEO 优化（基础 meta）
5. 二维码生成

---

### M4 · v1.3.0 桌面端 (Tauri) ✅

**周期**：T+9 ~ T+12 周

**交付**：

- Tauri 2 集成 Web 代码
- 系统托盘（显示"已同步 N 条"）
- 开机自启动（可关闭）
- 全局快捷键（⌘⇧M 唤起）
- 本地通知
- 离线优先（本地 SQLite 镜像）
- 打包：.dmg / .msi / .AppImage
- **Velopack 自动更新集成**（详见 [integrate-velopack.md](./integrate-velopack.md)）

---

### M5 · v1.4.0 Android 端 ✅

**周期**：T+12 ~ T+16 周

**交付**：

- React Native 项目搭建
- 复用 Web 端核心组件（适配移动）
- 本地存储（AsyncStorage；项目未安装 MMKV）
- 生物识别解锁（可选）
- 自动同步后台任务
- APK / AAB 打包

---

### M6 · v1.5.0 小程序端 (Taro) ✅

**周期**：T+16 ~ T+20 周

**交付**：

- Taro 3 项目搭建
- 复用 `shared/` 类型与主题
- 关键页面：笔记列表、编辑、设置、主题、分享管理
- 微信 / 支付宝 / 抖音小程序适配
- 提交审核

---

### M7 · v1.6.0 完善 ✅

**周期**：T+20 ~ T+24 周

**交付**：

- 端到端加密同步（草案 v1）
- 性能优化（虚拟滚动、增量同步）
- 可选协同编辑（CRDT 草案）
- 国际化 i18n
- 可访问性审计
- 暗色模式细节优化

---

### M8 · v2.0.0 双模式架构 ✅

**周期**：T+24 ~ T+28 周

**主题**：单机/联机双模式架构 + 全文档更新 + 补全未开发功能

**背景**：DustNote v0.1.0\~v1.5 全栈跨端能力已交付，但所有端硬依赖服务端，用户在没有服务器的情况下无法使用任何客户端。v2.0.0 引入双模式架构，让客户端在无服务器情况下独立运行。

#### 8.1 shared 层 ✅

- [x] [shared/src/repository.ts](file:///e:/workspace/dustnote/shared/src/repository.ts)（新增）：DataRepository 接口契约（loadAll/createNote/updateNote/moveNote/deleteNote/permanentDeleteNote/emptyTrash/restoreNote/createFolder/deleteFolder/createTag/deleteTag/getPreferences/setPreferences/exportBackup/importBackup/clearBusinessData）
- [x] [shared/src/local-auth.ts](file:///e:/workspace/dustnote/shared/src/local-auth.ts)（新增）：单机模式鉴权工具（setupLocalAuth/unlockLocalAuth/recoverLocalAuth/serializeLocalAuthBlob 等）
- [x] [shared/src/types.ts](file:///e:/workspace/dustnote/shared/src/types.ts)（修改）：新增 AppMode、NoteRow、Folder、Tag、Preferences、LocalAuthBlob、ModeState 类型
- [x] **关键改进**：masterKey 随机生成（不从密码派生），双重包装（passwordWrappedMasterKey + wrappedMasterKey），recover 后 masterKey 保留

#### 8.2 web 端 ✅

- [x] [web/src/lib/mode-store.ts](file:///e:/workspace/dustnote/web/src/lib/mode-store.ts)（新增）：zustand 管理模式状态，持久化到 localStorage
- [x] [web/src/lib/local-repo.ts](file:///e:/workspace/dustnote/web/src/lib/local-repo.ts)（新增）：IndexedDB 实现 DataRepository
- [x] [web/src/lib/remote-repo.ts](file:///e:/workspace/dustnote/web/src/lib/remote-repo.ts)（新增）：封装 ApiClient 实现 DataRepository
- [x] [web/src/lib/repository.ts](file:///e:/workspace/dustnote/web/src/lib/repository.ts)（新增）：工厂函数 createRepository
- [x] [web/src/lib/local-auth-storage.ts](file:///e:/workspace/dustnote/web/src/lib/local-auth-storage.ts)（新增）：LocalAuthBlob + LocalLockoutState 持久化
- [x] [web/src/components/ModeSelectDialog.tsx](file:///e:/workspace/dustnote/web/src/components/ModeSelectDialog.tsx)（新增）：首次启动选择 UI
- [x] [web/src/screens/StandaloneSetupScreen.tsx](file:///e:/workspace/dustnote/web/src/screens/StandaloneSetupScreen.tsx)、[StandaloneUnlockScreen.tsx](file:///e:/workspace/dustnote/web/src/screens/StandaloneUnlockScreen.tsx)、[StandaloneRecoverScreen.tsx](file:///e:/workspace/dustnote/web/src/screens/StandaloneRecoverScreen.tsx)（新增）
- [x] [web/src/lib/store.ts](file:///e:/workspace/dustnote/web/src/lib/store.ts)（修改）：支持双模式，添加 mode/repository/localAuthBlob/lockoutState 等
- [x] [web/src/App.tsx](file:///e:/workspace/dustnote/web/src/App.tsx)（修改）：根据 mode 显示不同鉴权流程
- [x] [web/src/lib/i18n.ts](file:///e:/workspace/dustnote/web/src/lib/i18n.ts)（修改）：添加 mode_select 和 settings.app_mode 翻译键

#### 8.3 mobile 端 ✅

- [x] [mobile/src/lib/mode-store.ts](file:///e:/workspace/dustnote/mobile/src/lib/mode-store.ts)（新增）：zustand + AsyncStorage 持久化
- [x] [mobile/src/lib/local-repo.ts](file:///e:/workspace/dustnote/mobile/src/lib/local-repo.ts)（新增）：AsyncStorage 实现 DataRepository（项目未安装 MMKV，使用 AsyncStorage 替代）
- [x] [mobile/src/lib/remote-repo.ts](file:///e:/workspace/dustnote/mobile/src/lib/remote-repo.ts)（新增）：封装 api 单例
- [x] [mobile/src/lib/repository.ts](file:///e:/workspace/dustnote/mobile/src/lib/repository.ts)（新增）：工厂函数
- [x] [mobile/src/lib/local-auth-storage.ts](file:///e:/workspace/dustnote/mobile/src/lib/local-auth-storage.ts)（新增）
- [x] [mobile/src/screens/ModeSelectScreen.tsx](file:///e:/workspace/dustnote/mobile/src/screens/ModeSelectScreen.tsx)（新增）
- [x] [mobile/src/screens/StandaloneSetupScreen.tsx](file:///e:/workspace/dustnote/mobile/src/screens/StandaloneSetupScreen.tsx)、[StandaloneUnlockScreen.tsx](file:///e:/workspace/dustnote/mobile/src/screens/StandaloneUnlockScreen.tsx)、[StandaloneRecoverScreen.tsx](file:///e:/workspace/dustnote/mobile/src/screens/StandaloneRecoverScreen.tsx)（新增）
- [x] [mobile/src/state/auth.ts](file:///e:/workspace/dustnote/mobile/src/state/auth.ts)（修改）：扩展支持双模式鉴权
- [x] [mobile/src/screens/SettingsScreen.tsx](file:///e:/workspace/dustnote/mobile/src/screens/SettingsScreen.tsx)（修改）：实现导入/导出（基于 Repository.exportBackup/importBackup + RNFS + Share）、模式切换、版本号 2.0.0
- [x] [mobile/src/api.ts](file:///e:/workspace/dustnote/mobile/src/api.ts)（修改）：**移除硬编码**，从 mode-store 动态读取 serverUrl
- [x] [mobile/src/App.tsx](file:///e:/workspace/dustnote/mobile/src/App.tsx)（修改）：根据 mode 路由

#### 8.4 miniprogram 端 ✅

- [x] 新增 4 个 lib 文件（mode-store、local-repo、remote-repo、local-auth-storage、repository）
- [x] 新增 4 个页面（mode-select、standalone-setup、standalone-unlock、standalone-recover）
- [x] [miniprogram/src/app.config.ts](file:///e:/workspace/dustnote/miniprogram/src/app.config.ts)（修改）：注册新页面

#### 8.5 desktop 端 ✅

- [x] [desktop/src-tauri/tauri.conf.json](file:///e:/workspace/dustnote/desktop/src-tauri/tauri.conf.json)、[Cargo.toml](file:///e:/workspace/dustnote/desktop/src-tauri/Cargo.toml)、[package.json](file:///e:/workspace/dustnote/desktop/package.json)：版本号 2.0.0
- [x] Velopack 更新机制正常，GITHUB_REPO_URL = "https://github.com/Hermitweb/dustnote"
- [x] [web/src/screens/PublicShareView.tsx](file:///e:/workspace/dustnote/web/src/screens/PublicShareView.tsx)：硬编码 '0.1.0' 改为 **APP_VERSION**

#### 8.6 server 端 ✅

- [x] [server/src/env.ts](file:///e:/workspace/dustnote/server/src/env.ts)：serverVersion/minClientVersion/recommendedClientVersion 默认 2.0.0
- [x] [server/src/routes/health.ts](file:///e:/workspace/dustnote/server/src/routes/health.ts)：使用 config.serverVersion
- [x] [server/src/services/update-manifest.ts](file:///e:/workspace/dustnote/server/src/services/update-manifest.ts)：miniprogram.version=2.0.0、minServerVersion=config.serverVersion
- [x] [server/.env.example](file:///e:/workspace/dustnote/server/.env.example)、[.env.example](file:///e:/workspace/dustnote/.env.example)、[docker-compose.yml](file:///e:/workspace/dustnote/docker-compose.yml)、[deploy/README.md](file:///e:/workspace/dustnote/deploy/README.md)、[scripts/smoke-test.sh](file:///e:/workspace/dustnote/scripts/smoke-test.sh)：版本号同步

#### 8.7 CI/Release ✅

- [x] [.github/workflows/release.yml](file:///e:/workspace/dustnote/.github/workflows/release.yml) 改造：资产重命名（`DustNote-<Platform>-<Version>.<ext>`）、三分区 Release body（客户端安装包/服务端部署/自动更新）、新增 build-server-zip job
- [x] 新增 [DEPLOY.md](file:///e:/workspace/dustnote/DEPLOY.md)：完整服务端部署文档（Docker Compose + 手动部署 + 反向代理 + HTTPS + 备份恢复 + 升级 + 故障排查）
- [x] macOS/Linux 桌面构建 `continue-on-error: true`，create-release `if: always()`
- [x] iOS 构建跳过（硬件限制）

#### 8.8 文档更新 ✅

- [x] 新增 [standalone-mode.md](./standalone-mode.md)
- [x] 更新 [PRD.md](./PRD.md)（添加 v2.0.0 双模式需求章节）
- [x] 更新 [tech-architecture.md](./tech-architecture.md)（数据访问层抽象、双模式架构、单机鉴权）
- [x] 更新 [data-flow.md](./data-flow.md)（单机模式数据流）
- [x] 更新 [update-strategy.md](./update-strategy.md)（v2.0.0 资产命名约定）
- [x] 更新 [security.md](./security.md)（单机模式安全模型）
- [x] 更新 [production-readiness.md](./production-readiness.md)（v2.0.0 + AsyncStorage 选择）
- [x] 更新 [v1.1-medium-low-priority.md](./v1.1-medium-low-priority.md)（标注完成状态）
- [x] 更新 [integrate-velopack.md](./integrate-velopack.md)（v2.0.0 Release 工作流改造）
- [x] 更新 [CHANGELOG.md](../../CHANGELOG.md)（v2.0.0 条目）
- [x] 更新 [README.md](../../README.md)（双模式介绍）
- [x] 更新 [docs/user-guide.md](../../docs/user-guide.md) / [docs/self-hosting.md](../../docs/self-hosting.md) / [docs/compatibility-matrix.md](../../docs/compatibility-matrix.md) / [docs/faq.md](../../docs/faq.md)

#### 8.9 跳过项（硬件限制） ⚠️

| 跳过项                   | 原因                          | 影响                                       |
| ------------------------ | ----------------------------- | ------------------------------------------ |
| iOS 构建                 | 需 macOS + Xcode + Apple 签名 | iOS 无安装包；RN 代码已编写，未来可构建    |
| macOS 桌面 vpk pack 实测 | 需 macOS 硬件                 | release.yml 已有 `continue-on-error: true` |
| iOS MMKV 实测            | 同上                          | AsyncStorage 跨平台一致，代码层面已支持    |

**不跳过**：iOS 代码编写（RN 跨平台）、release.yml macOS job（GitHub Actions 提供 macos-latest runner）。

#### 8.10 关键设计决策

1. **Repository 接口放 shared 层**：所有端共享类型契约，避免实现漂移
2. **mode-store 独立于 auth-store**：模式切换不影响鉴权状态
3. **保留现有 offline-first**：联机模式下 IndexedDB 缓存 + 离线队列不变
4. **单机模式不用离线队列**：所有操作直接写本地
5. **数据迁移显式触发**：用户点按钮才迁移，避免意外覆盖
6. **Velopack 资产命名只改用户入口**：内部文件（releases.\*.json + delta 包）保留原名
7. **mobile 用 AsyncStorage 而非 MMKV**：项目未安装 MMKV，AsyncStorage 跨平台一致
8. **小程序单机作轻量试用**：受 10MB 限制，文档明确

---

## 3. 资源与团队配置（建议）

| 角色            | 人数 | 关键产出                   |
| --------------- | ---- | -------------------------- |
| 产品            | 1    | PRD、需求优先级、用户验证  |
| 设计            | 1    | 视觉稿、组件库、设计 token |
| 前端 (Web/桌面) | 2    | Web 端、Tauri 集成         |
| 移动端          | 1    | Android RN、小程序 Taro    |
| 后端            | 1    | API、数据库、部署          |
| 测试 / QA       | 1    | 自动化测试、跨端验证       |

---

## 4. 风险与应对

| 风险                 | 影响        | 概率 | 应对                                  |
| -------------------- | ----------- | ---- | ------------------------------------- |
| Tauri 跨平台差异     | 桌面端延期  | 中   | 提前在 macOS / Windows 双环境验证     |
| 小程序审核           | 微信驳回    | 中   | 提前研究《小程序运营规范》            |
| 端到端加密实现复杂   | v1.6 延期   | 高   | 推迟到 v2.0 评估                      |
| .docx 复杂样式解析   | 导入效果差  | 中   | v1.1 限制支持基础样式                 |
| 单用户性能瓶颈       | v1.5+       | 低   | 单用户场景下 SQLite 足够              |
| 单机模式离线爆破     | 数据泄露    | 中   | Argon2id(m=64MB) + 客户端锁定 6/15min |
| 模式切换数据迁移冲突 | 数据丢失    | 中   | 显式触发 + 原子化 + 失败回滚          |
| MMKV 原生模块编译    | Mobile 延期 | 中   | 改用 AsyncStorage，已落地             |

---

## 5. 验收标准（每个里程碑通用）

- [ ] 所有新增功能在 Web / 桌面 / 移动 / 小程序对应端可用
- [ ] 主题在新增页面/组件上正确应用
- [ ] 关键路径有 E2E 测试覆盖
- [ ] 文档同步更新（README、CHANGELOG、用户手册）
- [ ] 灰度发布 1 周无 P0/P1 反馈

---

## 6. 沟通与节奏

- **周会**：每周一 30 分钟同步进度、风险、阻塞
- **双周评审**：每两周一次完整演示与回顾
- **月复盘**：每月一次产品 / 技术复盘
- **版本发布**：每完成一个里程碑即发版，使用 SemVer

---

## 7. v2.1.0 生产就绪度补强 ✅

**周期**：T+29 ~ T+30 周

**主题**：落实 production-readiness.md 中 8 项代码层 P1 任务，让产品达到「可日常使用」的完整度。

> 注：本里程碑主要在 **web / desktop 端**完成；mobile / miniprogram 端的功能对齐见 §8。

### 7.1 已交付（web / desktop）

- [x] **i18n 国际化框架**：[web/src/lib/i18n.ts](file:///e:/workspace/dustnote/web/src/lib/i18n.ts) 基于 react-i18next 中英双语
- [x] **键盘快捷键 Cheatsheet**（F1）：[web/src/components/Cheatsheet.tsx](file:///e:/workspace/dustnote/web/src/components/Cheatsheet.tsx)
- [x] **Sentry 错误监控**：[web/src/lib/sentry.ts](file:///e:/workspace/dustnote/web/src/lib/sentry.ts) + [server/src/sentry.ts](file:///e:/workspace/dustnote/server/src/sentry.ts)
- [x] **移动端生物识别解锁**：[mobile/src/screens/StandaloneUnlockScreen.tsx](file:///e:/workspace/dustnote/mobile/src/screens/StandaloneUnlockScreen.tsx)
- [x] **笔记历史版本**：迁移 id=9 + [web/src/components/NoteHistoryDialog.tsx](file:///e:/workspace/dustnote/web/src/components/NoteHistoryDialog.tsx)
- [x] **模板系统**：迁移 id=10 + [web/src/components/TemplatePicker.tsx](file:///e:/workspace/dustnote/web/src/components/TemplatePicker.tsx)
- [x] **全文搜索 v2**（内存倒排索引）：[web/src/lib/search.ts](file:///e:/workspace/dustnote/web/src/lib/search.ts)
- [x] **桌面托盘 + 全局快捷键**：[desktop/src-tauri/src/lib.rs](file:///e:/workspace/dustnote/desktop/src-tauri/src/lib.rs)

### 7.2 安全加固（v2.1.0 同期）

- [x] 单分享密码爆破锁定（迁移 id=11）：6 次错误 → 该分享锁 15 分钟
- [x] 分享密码改 POST body 传输（避免 URL/日志泄漏）
- [x] AES-GCM AAD 绑定能力（`encrypt/decrypt` 新增 `aad` 参数，向后兼容）
- [x] 密钥零化 `zeroize()`（masterKey / shareKey 用后清零）
- [x] JWT_SECRET 弱默认检测 + 最小 32 字符校验
- [x] /auth/recover 路径补账号锁定（与 unlock 共用计数器）
- [x] audit_log 覆盖登录/恢复/改密/锁定/分享创建/吊销/笔记永久删除
- [x] logger 脱敏 authorization/cookie/password/token/ciphertext

### 7.3 v2.1.0 已知缺口

- mobile / miniprogram 端尚未对齐 web 的 5 项能力（搜索/分享创建/导入导出/历史/模板）
- mobile / miniprogram 端无 i18n 框架
- CI 未覆盖 Android 构建（仅 build:web/server/miniprogram/desktop）

---

## 8. 后续路线图（v2.2+ 展望）

- **mobile / miniprogram 功能对齐**：补齐搜索 / 分享创建 / 导入导出 / 历史 / 模板 5 项能力
- **mobile i18n**：与 web 共用 i18n key 命名空间
- **CI Android 构建**：mobile 端一等公民的回归保护
- iOS 客户端正式构建（待 macOS 硬件 + Apple 签名）
- macOS 桌面 vpk pack 实测（待 macOS 硬件）
- CRDT 实时协同编辑
- 多用户协作（家庭 / 团队版）
- AI 助手（写作润色、自动标签、问答）
- 双向链接 / 知识图谱
- 插件系统（自定义块、自定义主题）
- 桌面 Widget、移动桌面插件
- 公开 API、Webhook
- 商业化（家庭共享、付费主题）
