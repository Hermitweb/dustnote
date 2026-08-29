# 更新日志

本项目所有显著变更记录于此。格式基于 [Keep a Changelog](https://keepachangelog.com/)，版本遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

### 计划中

- iOS 客户端正式构建（待 macOS 硬件 + Apple 签名）
- macOS 桌面 vpk pack 实测（待 macOS 硬件）
- CRDT 实时协同编辑
- AI 助手（写作润色、自动标签、问答）
- 知识图谱
- 插件系统

## [2.5.17] - 2026-08-29

### 新功能（多端同步）

- **双向链接全端贯通**：Miniprogram + Mobile 的 `[[标题]]` wikilink 由「仅展示」升级为可点击跳转（解密全库按标题定位，找不到给提示），预览模式底部新增反向链接面板（列出引用当前笔记标题的其他笔记，点击直达），与 Web 端语义一致
- **Mobile 历史版本支持解密预览**：版本列表点击先解密展示标题+内容摘要，可在预览中直接选择恢复（对齐 Web/Miniprogram 的「先看再恢复」体验）
- **Web 编辑模式悬浮说明**：编辑/分屏/预览/WYSIWYG 四个模式按钮增加悬浮提示（中英双语），WYSIWYG 补上此前缺失的 i18n key

### 修复

- **Miniprogram 语法错误（阻断 CI typecheck 门禁）**：`note/edit.tsx` 三元表达式分支缺 Fragment 包裹导致 `tsc` 编译失败，连带暴露的 `totp-client.ts` 类型错误（引用了 store 上不存在的字段）改走标准 `getApi()` 通道
- **Web 分屏/预览模式滚动穿透**：`main#main-content` 缺 `min-h-0`，长笔记把 flex 容器撑到内容高度，顶栏/侧栏跟着整体滚动；补齐约束链后预览面板恢复内部滚动
- **Web Sidebar 陈旧过滤**：`visibleNotes` 的 useMemo 缺 `folderScope` 依赖，文件夹同步后列表仍按旧范围过滤
- **Mobile 死代码清理**：5 个 lint 警告清零（未使用 import / 变量），连带修复被增量缓存掩盖的 `styles.modalButtonDisabled` 未定义引用

### 依赖

- **安全治理**：`pnpm.overrides` 新增 webpack-dev-server ^5.2.6、fast-xml-parser ^5.7.0、uuid ^11.1.1，`pnpm audit` 从 11 项降至 3 项（剩余 swiper critical + image-size ×2 high 为 Taro/RN 工具链无补丁项，CI 豁免清单已登记）
- **仓库卫生**：`desktop/src-tauri/gen/schemas/`（tauri 构建生成物）不再入库；清理根目录 14 个调试遗留日志；`.opencode/`、`.mimosa/` 加入 gitignore

## [2.5.16] - 2026-08-28

### 修复

- **Mobile 创建笔记继承当前选中文件夹**：不再默认归类到"未分类"，当前选中哪个文件夹就创建到哪个
- **Mobile 文件夹管理改进**：去掉内置分支分类（work/personal）、树形展开/折叠、弹窗添加 X 关闭按钮
- **Mobile 生物识别解锁修复**：锁定时不再清除 AsyncStorage 中的 token，生物识别解锁可正常读取缓存
- **Shared 测试连接完善**：三端统一添加 10s 超时 + URL 预校验 + 错误消息区分（超时/不可达/服务器错误）
- **Mobile unlock/changePassword 使用 PBKDF2**：所有 deriveSecrets 调用统一传 KDF_PARAMS_MOBILE，避免 Argon2id 阻塞主线程

## [2.5.15] - 2026-08-28

### 新功能（多端同步）

- **Mobile + Miniprogram 同步 v2.5.13 核心功能**：
  - TOTP 两步验证：设置页启用/禁用，解锁时自动检测并显示验证码输入
  - 双向链接 `[[标题]]`：Markdown 渲染器支持 wikilink 语法，显示为可点击链接
  - 斜杠命令：编辑器输入 `/` 弹出命令菜单（日期/标题/列表/待办/代码块/引用/分割线/表格/链接）
- **Mobile 无障碍改进**：UnlockScreen 添加 accessibilityLabel + accessibilityRole

### 依赖

- Mobile 新增 `totp-client.ts`、`slash-commands.ts`、`SlashCommandMenu.tsx`
- Miniprogram 新增 `totp-client.ts`、`slash-commands.ts`

## [2.5.14] - 2026-08-28

### 修复

- **Android 明文 HTTP 流量被系统静默拦截**：Android 9+ 默认阻止非白名单的明文 HTTP 请求，`network_security_config.xml` 仅包含 localhost 和 `10.0.2.2`，导致 React Native fetch 请求到公网 HTTP 自建服务器时被系统拦截（请求从未离开设备，表现为「卡在鉴权状态」）。添加 `usesCleartextTraffic=true` + 扩展 `network_security_config.xml`。

## [2.5.13] - 2026-08-27

### 新功能

- **WYSIWYG 编辑器模式**（TipTap 集成）：所见即所得编辑，支持标题/粗斜体/代码块/链接/图片/待办列表/引用/分割线，与 Markdown 模式并列切换
- **WebAuthn/Passkey 无密码认证**：FIDO2 注册/认证完整实现，支持 platform authenticator（指纹/面容/PIN）
- **网页剪藏浏览器扩展**：Chrome Manifest V3 扩展，提取页面标题+正文 → 发送到 DustNote 创建笔记

### 改进

- **双向链接 `[[笔记标题]]`**：自定义 marked extension 解析 wikilink 语法，预览模式点击跳转，反向链接面板显示引用源
- **斜杠命令系统**：编辑器输入 `/` 弹出命令菜单（日期/标题/列表/待办/代码块/引用/分割线/表格/双向链接），键盘导航+模糊搜索
- **TOTP 两步验证**：服务端 TOTP 实现（RFC 6238，纯 Node crypto），客户端 setup2fa/enable2fa/disable2fa API，unlock 支持 totpCode
- **图片存储优化**：粘贴/拖拽图片时 base64 存入 IndexedDB，笔记内容只保留 `dustnote-img://id` 引用（~40字节 vs 原始 1.37MB）
- **Playwright E2E 测试框架**：单机模式全流程测试 + HTTP 环境提示 + 健康检查
- **组件测试补充**：wikilink 提取/反向索引、斜杠命令过滤/替换、图片统计
- **无障碍改进**：skip-to-content 链接、`<main>` landmark、`role=navigation`、`prefers-reduced-motion` 媒体查询

## [2.5.12] - 2026-08-26

### 修复 — 版本更新功能全面加固

- **Rust `is_newer_version` 完整 SemVer 2.0.0 支持**：正确处理预发布标签（`2.5.12-beta.1` < `2.5.12`），数字段按数值比较、混合段按字典序比较
- **GitHub API 限流处理**：检测 403 + `x-ratelimit-remaining=0`，友好提示「请约 N 分钟后重试」
- **`set_proxy_env` 线程安全**：`OnceLock` 保证仅首次调用写入 env var，消除多线程竞争
- **mobile `APP_VERSION` 去重**：新增 `mobile/src/lib/version.ts` 单一来源，`use-update-check.ts` + `api.ts` 统一 import，消除两处独立硬编码的同步风险
- **server 小程序版本号自动跟随**：`update-manifest.ts` 改用 `config.serverVersion`，消除手动同步遗漏风险

## [2.5.11] - 2026-08-23

### 优化 — HTTP 直连（非安全上下文）环境适配集中化

- **新增 `lib/env.ts` 统一环境能力检测**：`isSecureContext` / `isPlainHttp` / `canReadClipboard` / `canRegisterServiceWorker`，集中管理此前散落各处的安全上下文 API 判断
- **读剪贴板预检**：Editor.tsx 从剪贴板插入前先检测能力，HTTP 环境下明确提示「浏览器禁止读取剪贴板」而非走异常路径
- **Service Worker 注册**：main.tsx 改用统一检测（语义化，行为不变）
- **HTTP 环境用户提示**：App.tsx 解锁后一次性 toast 说明受限功能（PWA 离线/读剪贴板/语音输入），localStorage 标记避免重复打扰
- **文档**：DEPLOY.md 新增 §7.4「HTTP 直连功能差异」对照表
- **测试**：新增 env.test.ts（4 用例）与 clipboard.test.ts（4 用例，jsdom 无 execCommand 已桩化）

## [2.5.10] - 2026-08-23

### 修复 — HTTP 直连下复制分享链接崩溃（阻断性）

- **`navigator.clipboard.writeText` 非安全上下文不可用**：与 crypto.randomUUID 同类问题，`navigator.clipboard` 仅在 HTTPS / localhost 存在，经 `http://<公网IP>` 访问时 Editor.tsx / SharesManager.tsx 复制分享链接直接抛 `TypeError: Cannot read properties of undefined (reading 'writeText')`。新增 `lib/clipboard.ts` 的 `copyText()`：优先 Clipboard API（可选链 + try-catch），降级 `document.execCommand('copy')`（非安全上下文可用）

## [2.5.9] - 2026-08-23

### 修复 — HTTP 直连（非安全上下文）无法创建笔记（阻断性）

- **`crypto.randomUUID` 非安全上下文不可用**：该 API 仅在 HTTPS / localhost 存在，用户经 `http://<公网IP>` 访问时 `window.crypto.randomUUID` 为 undefined，`createNote` 抛 `TypeError: crypto.randomUUID is not a function`。新增 `randomUuid()`（基于 `crypto.getRandomValues` + `Math.random` 回退）替代，覆盖 store.ts 两处笔记创建与 local-repo.ts 单机 ID 生成，彻底移除 web 端 crypto.randomUUID 依赖

## [2.5.8] - 2026-08-23

### 修复 — 跨域 Web 客户端完全不可用（阻断性）

- **CORS 预检请求（OPTIONS）被中间件拦截**：authMiddleware 返回 401 missing_token、versionCheckMiddleware 返回 400 missing_client_headers。浏览器跨域预检按规范不携带 Authorization 与自定义头，导致自定义域名部署 web / 桌面端联机模式访问远程服务器时所有 API 调用失败（同源部署不发预检故此前未暴露）。两中间件均放行 OPTIONS，实际权限校验仍由实际请求方法承担

## [2.5.7] - 2026-08-23

### 修复 — 服务端部署包开箱即坏（阻断性）

- **Dockerfile / server/Dockerfile 移除陈旧 `COPY patches`**：仓库无 `patches/` 目录、package.json 亦无 `patchedDependencies`，此前任何人 clone 源码或下载部署包构建镜像都必然失败
- **顶层 Dockerfile 补齐 client-core 构建链**：web 声明 `@dustnote/client-core: workspace:*` 但镜像构建既未 COPY 也未构建，导致 tsc 报 6 处 TS2307、web 构建失败
- **release.yml 服务端打包补 web/、client-core/、.npmrc**：v2.5.6 及更早的 dustnote-server 部署包缺失一体化 Dockerfile 必需文件，解压后无法构建

### 修复 — Web 端运行时缺陷

- **创建文件夹必然 400（invalid_body）**：web 端创建顶层文件夹时永远发送 `branch: null`，服务端 zod schema（`z.enum().optional()`）拒绝 null；schema 改为 `nullish()`，客户端发送端同步对齐（store.ts / remote-repo.ts 为 null 时不发送）
- **PWA 离线能力从未生效**：index.html 的 Service Worker 注册写在内联 `<script>`，被 nginx CSP（`script-src 'self'`）拦截；已移至 main.tsx 模块内
- **合成键盘事件崩溃防御**：部分浏览器插件会派发无 `key` 属性的合成 KeyboardEvent，`e.key.toLowerCase()` 读取 undefined 抛 TypeError；快捷键系统与 main.tsx 均加防御

### 测试

- 新增端到端部署验证（真实加密流程）：setup/unlock/refresh 会话、笔记与文件夹 CRUD、乐观锁冲突、软删除回收站、分享创建/公开访问/吊销、CORS、CSP、设备管理、容器重启数据持久性——70 项断言全部通过

## [2.5.6] - 2026-08-21

### 安全 — 依赖漏洞治理（high/critical 33 → 6 项无补丁豁免）

pnpm audit 全量扫描后系统性治理：**修复 27 项、豁免 6 项（全部为官方无修复版本）**，运行时依赖漏洞清零，CI 审计豁免清单从 27 收缩至 6。

#### 直依赖升级（A 类）

- **vitest ^1.6.0 → ^3.2.6**（critical GHSA-5xrq-8626-4rwp）：全 workspace 6 包（shared/client-core/server/web/desktop/miniprogram），264 项测试全部通过
- **vite ^5.3.1 → ^6.4.3**（high GHSA-fx2h-pf6j-xcff 等 3 项）：web + desktop，构建产物验证一致

#### 传递依赖精确锁版本（B 类 16 项，pnpm.overrides 精确版本键）

采用精确版本键（如 `vm2@3.11.5: ^3.11.6`）只重定向漏洞实例，不触碰同包健康实例与旧 major 线（minimatch@3 / glob@7 等 15 个老实例不受影响）：

- **vm2 3.11.5 → 3.11.6**（critical ×3 + high ×2，@tarojs/webpack5-runner）：原维护者 2026-08-14 发布的真实补丁（此前报告误判为空头版本）
- **form-data 2.3.3 → 2.5.6**（critical + high，@tarojs/cli > request）
- minimatch 9.0.3 → 9.0.9（×3）/ nanoid 3.3.15 → 3.3.18（×2）/ js-yaml 3.15.0 → 3.15.1 与 4.3.0 → 4.3.1 / svgo 2.8.2 → 2.8.3 / serialize-javascript 6.0.2 → 7.0.7 / tmp 0.0.33 → 0.2.7 / http-cache-semantics 3.8.1 → 4.1.1 / adm-zip 0.4.16 → 0.6.0 / glob 10.2.6 → 10.5.0
- **postcss 困局破解**：postcss 8 移除 `postcss.plugin()`（Taro 的 autoprefixer 9 依赖），成对替换 postcss@7 → 8.5.26 + autoprefixer@9 → 10.4.27，Taro H5/WeApp 双构建 CSS 产物字节级一致
- 已有 override 上调：brace-expansion ^1.1.16 → ^1.1.18、fast-uri ^3.1.4 → ^3.1.5

#### moderate 顺手修复（运行时漏洞清零）

- **body-parser 1.20.5 → 1.20.6**（全项目唯一运行时依赖漏洞，express 链路）
- qs 6.5.5 → 6.15.3、esbuild 0.19.12/0.14.54 → 0.25.12（与 vite 6 链路统一）

#### 审计豁免清单（ci.yml，27 → 6 项，全部无补丁）

swiper（Taro 3.6 钉死 6.x）、decompress / git-clone（download-git-repo 废弃链路）、html-minifier（webpack5-runner）、image-size ×2（less / metro，<=2.0.2 全线无修复）——均位于构建期工具链，不进入运行时产物，待 Taro 主版本升级根治。

### 工具链 — CI 门禁修复

- **prettier 全仓统一**（246 文件纯格式化）：修复 format:check 在 dev 分支长期红门禁（stash 对照验证为历史遗留）
- 清理被 stderr 污染的 audit-raw.json；audit.json / audit-raw.json 加入 .gitignore（CI 审计步骤会生成 audit.json，防止误提交）

### 回归验证

264 项单测、typecheck、lint（0 errors）、format:check、web/desktop（vite 6）构建、miniprogram H5/WeApp（Taro webpack）构建、CI 审计门禁模拟全部通过。

### 版本号同步

全端版本号同步至 2.5.6（package.json ×8、tauri.conf.json、Cargo.toml + Cargo.lock、Android versionCode 28→29、server env/update-manifest、mobile/miniprogram 源码内嵌 APP_VERSION、release.yml、sw.js、.env.example、docker-compose、deploy 脚本与文档）。

## [2.5.5] - 2026-08-21

### 新增 — @dustnote/client-core 跨端内核 + 目录结构范式 + 全端功能对齐

#### 架构：client-core 跨端客户端内核（新包）

把 web/mobile/miniprogram 各自维护的离线队列、同步编排、加密信封、409 冲突合并抽成框架无关的纯逻辑包（`offline-queue` / `sync-engine` / `envelope` / `conflict` / `crypto-backend`），四端共享同一套同步与冲突语义：

- **409 冲突处理升级**：旧版静默丢弃（多设备离线编辑同一笔记会静默丢数据）→ 字段级 3-way 合并；无歧义字段自动合并并静默 re-PATCH，有歧义字段由全局 ConflictDialog 让用户裁决（local / server / merged），三端 + desktop 全部接入
- **miniprogram 新增离线队列**（此前网络失败直接丢失请求）
- **mobile 队列旧 key 无缝迁移**（dustnote_offline_queue → 新格式，load 时兼容转换）

#### 目录结构范式（v2.5.5 规范落地）

按 `docs/note-system-folder-structure-spec.md` 落地「扁平优先、浅嵌套、容器隔离」：

- 顶层二元隔离：文件夹必属 work（💼 业务·项目）/ personal（🌿 个人·沉淀）分支，子文件夹继承父分支
- 最大嵌套深度 2 级，服务端代码层拦截；新增 `renameFolder` / `moveFolder` API
- web Sidebar 按新范式重写；mobile / miniprogram 文件夹页补齐新范式 UI（分支选择、深度拦截、重命名/移动菜单、移动合法性校验）
- server folders 路由 handler 具名导出，新增数据层单测

#### 功能对齐（以 web 为基准）

- **删除账户 UI（GDPR Article 17）**：服务端 DELETE /account 早已就绪，本次补齐 web / mobile / miniprogram 三端入口（两步确认 + 成功后自动回到初始化流程）
- **设备管理 UI**：mobile / miniprogram 补齐（服务端 GET/DELETE /devices 已就绪，web 原有）
- **miniprogram 搜索升级**：标题搜索 → 标题 + 内容全文搜索
- **miniprogram 历史版本**：编辑页新增版本列表 + 恢复（拉密文解密 → 服务端 restore，与 mobile 同路径）
- 标签独立页从三端移除（检索交由搜索/筛选）

### 修复 — 测试与工具链

- **web 组件测试 React 双实例修复**：hoisted 布局下 web react@18.3.1 与 RN 钉死的 react@18.2.0 共存导致 useState 崩溃（30 项测试失败）。web 的 react/react-dom 统一钉到 18.2.0，全仓单一物理 react；删除永远 no-op 的 ensure-react-junction pretest 脚本
- **offline-queue 测试迁移**：mock 从 idb-keyval 迁到 client-core（MemoryQueueStorage 替换 IndexedDB）
- **better-sqlite3 ^11 → ^12**：原生支持 Node 24（11.x 在 Node 24 下 `Statement::~Statement()` 崩溃），删除本地 patch，engines 放宽 node <25，.nvmrc 钉 Node 20
- **CI Android 构建改硬门禁**（移除 continue-on-error）
- 修复 3 个未定义 i18n key（common.continue / import_export.file_too_large / settings.save_fail），i18n 450 keys 全部通过校验

### 版本号同步

全端版本号同步至 2.5.5（package.json ×8 含 client-core、tauri.conf.json、Cargo.toml、Android versionCode 27→28 / versionName、server env/update-manifest、mobile/miniprogram 源码内嵌 APP_VERSION、release.yml、sw.js、.env.example、docker-compose、deploy 脚本与文档）。

## [2.5.4] - 2026-08-18

### 新增 — 一条命令安装部署（从 GitHub 拉取）

- **install.sh / install.ps1 入口**：新增一条命令入口脚本，从 GitHub Release 拉取部署包并自动完成部署（无需先 clone 仓库）。Linux/macOS：`curl -fsSL .../deploy/install.sh | bash`；Windows：`powershell ... "iwr .../deploy/install.ps1 | iex"`。
- **脚本按平台分类**：`deploy/` 目录明确区分 `install.*`（拉取 + 部署入口）与 `deploy.*`（部署执行），`nginx.conf` / `Caddyfile` / `supervisord.conf` 为通用反代 / TLS / 进程配置。
- **部署文档更新**：README / DEPLOY.md / deploy/README.md 按平台补充一条命令安装部署说明，GitHub Release 正文同步更新。

## [2.5.3] - 2026-08-18

### 新增 — 跨平台一键部署

- **一键部署脚本**：新增 `deploy/deploy.sh`（Linux / macOS）与 `deploy/deploy.ps1`（Windows），一条命令完成「检测/安装 Docker → 配置镜像源 → 生成随机 `JWT_SECRET` → 构建启动 → 等待健康检查 → 输出访问地址」。
- **中国网络镜像源**：`--cn` / `-Cn` 参数自动切换 aliyun apk 源、npmmirror npm 源、docker 镜像加速。

### 修复 — 部署与版本声明

- **Node 版本声明收紧**：`engines.node` 改为 `>=20 <24`，明确禁止 Node 24（better-sqlite3 11.x 不兼容导致 `Statement::~Statement()` 崩溃）。
- **Docker 一体化部署**：`docker-compose.yml` 默认使用根 Dockerfile（web + nginx + API 单容器），Caddy 反代到 `dustnote:80`。
- **镜像源参数化**：Dockerfile 新增 `APK_MIRROR` / `NPM_REGISTRY` 构建参数，`--cn` 下自动注入国内源。

## [2.5.1] - 2026-08-13

### 修复 — 跨端环境差异导致的加密功能缺失（恢复码页不显示/崩溃）

对「无 WebCrypto / 无 btoa-atob / 无 TextEncoder / kdfParams 不完整」等环境假设进行全端审查与加固，恢复码展示流程在三端（web / mobile / miniprogram）实测通过。

#### 小程序（P1）

- **无 WebCrypto 环境加密修复**：基础库不提供 `crypto.subtle` / `getRandomValues` / `btoa` / `atob`，首次搭建生成恢复码时全部加密操作失败。修复：新增 `crypto-polyfill`（`wx.getUserCryptoManager().getRandomValues` 安全随机池 + shared 注入同步取用），shared 层补纯 JS 回退（PBKDF2/HMAC/AES-GCM 经 @noble），`mode-select` 能力检测放行 weapp。
- **kdfParams 缺失修复**：`LocalAuthBlob.kdfParams` 记录 `algorithm`（argon2id/pbkdf2）与 `iterations`，避免解锁时误用 Argon2id 崩溃（`p should be 1 <= p < 2^24`）。

#### Shared / 跨端（P1）

- **TextEncoder/TextDecoder 惰性化**：此前模块顶层 `new TextEncoder()`，缺该全局对象的运行时在 import 阶段整体崩溃。改为首次使用实例化 + 缺失时清晰报错。
- **randomBytes 兜底**：平台注入随机源失败时尝试 noble 兜底，并保留「随机池未就绪」原始错误便于定位。
- **kdfParams 补全**：mobile `buildLocalAuthBlobForMasterKey`、server auth 路由两处构造点补齐 `algorithm`/`iterations`。

#### 部署（P2）

- **服务器完整版部署**：API-only 容器无 web 前端导致「输入密码后不跳恢复码页」。改用根 Dockerfile（web+nginx+API 一体），web:8091 / api:8090，浏览器端到端实测恢复码流程通过。构建环境修复：apk 阿里云镜像、npm npmmirror 源、docker 镜像源切换、构建容器 DNS 域名钉死。

## [2.4.4] - 2026-08-05

### 修复 — 首席架构师 SOP 零故障加固（服务端一致性 + 跨端健壮性 + 安全纵深）

以四步 SOP（需求差异分析 → 深度代码扫描 → 静默修复 → 自动化验证闭环）对全端代码再次地毯式排查，修复 20+ 处真实问题，覆盖 server / web / mobile / miniprogram / desktop 全栈。

#### 服务端（P1/P2）

- **增量同步失效修复（P1）**：`server_updated_at` 此前在所有写路径（PATCH/DELETE/restore）都不更新，`GET /notes?since=` 增量同步恒拉不到变更。修复：三条写路径均显式 `strftime('%Y-%m-%dT%H:%M:%fZ','now')` 更新，与 version 同步递增。
- **回收站提前清理修复（P1）**：`deleted_at` 历史混用 `datetime('now')`（空格分隔）与 ISO 格式，SQL 字符串比较导致「同日时空格 < 'T'」的字节序偏差，删除满 29 天即被永久清理（最多提前 ~24h）。修复：`trash-cleanup` 改用 `julianday()` 解析比较，两种格式均正确；软删除统一写 ISO。
- **JWT_SECRET 弱占位绕过修复（P1）**：`.env.example` 占位值 `change-me-to-a-32-char-random-string`（长度 36 ≥ 32）可绕过生产环境强校验，导致以公开密钥签名任意 token。修复：加入 `KNOWN_WEAK_DEFAULTS` + 弱模式正则（change-me/your-secret/random-string 等）双重拒绝，`.env.example` 占位改为空值并注明生成方式。
- **锁定计数丢失更新修复（P2）**：auth unlock/recover、分享密码校验的「读→await verifyPassword→写」模式存在并发丢失更新（可绕过锁定阈值）。修复：新增 `recordFailureAtomic`，单条 UPDATE 原子完成「+1 计数 + 达阈值置锁」。
- **deletedAt 空串绕过保留期修复（P2）**：`deletedAt:""` 会恒小于 cutoff 被立即永久删除。修复：ISO-8601 格式校验，非法值 400。
- **WebSocket token 泄漏修复（P2）**：access token 从 URL query 迁移到 `Sec-WebSocket-Protocol` 子协议，避免进入 nginx/Caddy access log（升级握手不经 pino-http 脱敏）。
- **纵深防御补齐（P2/P3）**：auth 公开路由 deviceId/platform 头校验；`touchDevice` UPDATE 补 user_id；`DELETE /note-tags` 校验 tag 归属；文件夹删除包事务；`/export/notes/:id` UUID 校验；ciphertext/content 长度上限；`since` 游标格式校验；update-manifest channel 头校验；错误处理器保留 400/413 语义；health 不回传内部错误；jwt.ts 改走 pino 日志；setup 不再泄漏 zod schema。

#### Web 端（P1/P2）

- **笔记历史对话框修复（P1）**：`fetchVersions`/`selectVersion` 改用 `apiBase()` 绝对路径（桌面端 webview origin 为 `tauri://localhost`，相对路径命中资源服务器），并加 JSON content-type 校验与请求竞态防护。
- **宽限期免密解锁假解锁修复（P1）**：联机模式 `graceUnlock()` 恢复 masterKey 但 accessToken 已被 lock() 清空 → 所有 API 401 假解锁。修复：联机模式宽限恢复时走 `/auth/refresh` 重新取 token，失败回退密码解锁。
- **分享页异源部署修复（P2）**：PublicShareView 硬编码同源 `/api/v1`，改为从 mode-store 读 serverUrl。
- **切笔记丢数据修复（P2）**：autoSave 防抖窗口（800ms）内切笔记，cleanup 仅清定时器导致未保存输入被新笔记覆盖丢失。修复：render 期 ref 检测切笔记，cleanup 立即补存。
- **日志脱敏失效修复（P2）**：diagnostics.ts 正则带锚点匹配不到 `accessToken/masterKey` 等组合键名，且 console 输出原始 ctx。修复：包含匹配 + 递归脱敏 + 输出脱敏后值。
- **其他（P3）**：WS 广播防抖合并；空回收站改顺序删除；离线队列 5xx 指数退避；MigrationWizard 模式/URL 校验；分享有效期输入校验；crypto 非安全上下文回退；语言 key 常量统一。

#### Mobile / Miniprogram / Desktop（P1/P2）

- **单机模式锁屏后无法解锁修复（P1）**：mobile `lock()` 清空内存 `localAuthBlob` 后，`unlockStandalone`/`recoverStandalone` 直接判空抛「未初始化」，必须杀进程重启。修复：从持久化层兜底重新加载 blob。
- **移动端导入备份后导航中断修复（P2）**：`navigation.reset('Unlock')` 在单机模式无此路由。修复：按 appMode 选择 `StandaloneUnlock`/`Unlock`。
- **小程序 H5 分享链接修复（P2）**：硬编码 `http://localhost:10086` 指向访客本机。修复：用 `window.location.origin` 拼同源链接。
- **版本号硬编码统一（P2）**：mobile api/use-update-check/SettingsScreen、miniprogram auth 内嵌 `2.4.0/2.4.3` 漂移导致「检查更新」恒误报新版本（版本倒挂）。修复：全端统一 2.4.4。
- **其他（P3）**：mobile ErrorBoundary 生产隐藏堆栈；解锁页空密码校验（避免浪费失败配额）；NoteEditScreen 卸载前 flush 未保存内容；mobile local-repo version 单调递增（与 miniprogram 一致）；resolveBaseUrl 尾部斜杠处理；desktop 删除残留 `greet` 调试命令。

#### 版本号同步

全端版本号同步至 2.4.4（package.json ×7、tauri.conf.json、Cargo.toml/Cargo.lock、Android versionCode 22/versionName、server env/update-manifest、mobile/miniprogram 源码内嵌 APP_VERSION、release.yml、smoke-test.sh、sw.js、.env.example、docs/installation-guide.md）。

## [2.4.0] - 2026-08-04

### 新增 — 全端安装/卸载/部署流程规范化 + 品牌统一

按各平台「安装、卸载、部署流程目标」对全端分发能力进行系统性补齐，统一项目品牌标识，并新增 Web PWA 与 Windows MSI 安装包。

#### Web 端 PWA（新增）

- **manifest.json + Service Worker**：Web 端正式支持 PWA 安装。`index.html` 链接 manifest 并在 HTTPS 环境注册 `sw.js`。
- **离线能力**：SW 缓存策略为静态资源 stale-while-revalidate、API/导航 network-first，断网下仍可访问已缓存笔记。
- **安装入口**：新增 `use-pwa-install.ts` hook 监听 `beforeinstallprompt`，设置对话框增加「📲 安装为桌面应用」按钮；已安装状态显示「✓ 已安装为独立应用」。

#### Windows MSI 安装包（新增）

- **默认 Program Files**：`release.yml` 新增独立 vpk pack 步骤生成 PerMachine MSI（`--msi --instLocation PerMachine`），默认安装到 `Program Files\DustNote`。vpk 内置 WiX 5，CI 无需单独安装。
- **自定义安装路径**：MSI 交互 UI 可修改目录；静默部署通过 `msiexec /i X.msi /qn VELOPACK_INSTALLDIR="<DIR>"` 指定。
- **不阻断发布**：MSI 步骤 `continue-on-error: true`，WiX/MSI 生成失败时一键 Setup.exe（PerUser，无需管理员）仍正常发布，二者共用同一 `Update.exe` 自动更新通道。
- **静默部署**：`msiexec /i DustNote.msi /qn`（安装）/ `msiexec /x DustNote.msi /qn`（卸载），支持 `VELOPACK_INSTALLDIR` 与 `/L*v` 日志。

#### Linux 桌面集成（新增）

- **.desktop 文件 + 安装/卸载脚本**：新增 `desktop/linux/dustnote.desktop`、`install.sh`、`uninstall.sh`，支持用户级（`~/.local/share`，无需 sudo）与系统级（`/usr/share`，需 sudo）两种集成方式。
- **release.yml 桌面集成包**：create-release 作业打包 `DustNote_<ver>_linux-desktop-integration.tar.gz`（.desktop + 图标 + 脚本），不依赖 Linux 二进制构建是否成功。

#### 品牌统一（新增）

- **全端统一 logo / 软件图标**：以「尘心笔记.webp」为源，通过 `scripts/generate-icons.py` 生成全平台图标（Desktop Tauri icon.png/ico/icns、Android ic_launcher、Web favicon/apple-touch-icon、Miniprogram logo）。
- **UI logo 替换**：Web（7 文件含 App.tsx、Sidebar）、Mobile（6 文件含 UnlockScreen、App.tsx）、Miniprogram（5 页面）将 emoji 🌿 统一替换为图片元素；新增 `images.d.ts` 类型声明。

#### Android 权限最小化

- **移除未使用的 RECEIVE_BOOT_COMPLETED 权限**：项目无对应 BroadcastReceiver，声明违反最小权限原则。现有权限（INTERNET / ACCESS_NETWORK_STATE / USE_BIOMETRIC / USE_FINGERPRINT / READ_EXTERNAL_STORAGE(maxSdkVersion=32)）均有实际用途。

#### 部署文档

- **新增 [docs/installation-guide.md](./docs/installation-guide.md)**：覆盖 Windows（MSI/Setup.exe/便携版）、Linux（AppImage + 桌面集成）、macOS、Android、Web（PWA）全平台安装、卸载、静默部署、自动更新、数据存储位置与卸载后清理。

### 涉及文件

- `web/public/manifest.json`（新）、`web/public/sw.js`（新）、`web/index.html`、`web/src/lib/use-pwa-install.ts`（新）、`web/src/components/SettingsDialog.tsx`
- `desktop/linux/dustnote.desktop`（新）、`desktop/linux/install.sh`（新）、`desktop/linux/uninstall.sh`（新）
- `.github/workflows/release.yml` — vpk pack 拆分 Setup.exe + MSI、create-release 增加 .msi 与 linux-desktop-integration 资产、发布说明
- `mobile/android/app/src/main/AndroidManifest.xml` — 移除 RECEIVE_BOOT_COMPLETED
- `scripts/generate-icons.py` 与全端图标资源、UI logo 替换（63 文件）
- `docs/installation-guide.md`（新）
- 全端版本号同步至 2.4.0（package.json ×7、tauri.conf.json、Cargo.toml、Android versionCode 18/versionName、server env/update-manifest、mobile/miniprogram 源码内嵌 APP_VERSION、release.yml、smoke-test.sh、sw.js）

## [2.3.8] - 2026-08-01

### 修复 — 首席架构师 SOP 零故障加固（跨端健壮性 + 安全 + 日志脱敏）

延续 v2.3.7 的四步 SOP，本轮聚焦跨端代码健壮性、安全纵深与日志脱敏的补强。修复客户端与服务端共 17 个文件，覆盖 Web / Desktop / Mobile / Miniprogram / Server 全栈。

#### 客户端健壮性（P1）

- **小程序单机模式重定向死循环修复（P1）**：standalone-setup / standalone-unlock / standalone-recover 三个页面此前直接调用 shared 层 `setupLocalAuth` / `unlockLocalAuth` / `recoverLocalAuth`，仅写存储 + 发事件，**未更新 auth store 的 `authState`**。页面跳回首页时，index 页读取 `authState` 仍为 `needs_unlock`，触发重定向回 unlock 页 → 死循环。修复：三页改为调用 auth store 的 `setupStandalone` / `unlockStandalone` / `recoverStandalone` action，由 store 统一负责持久化 blob + 缓存 masterKey + 更新 `authState='unlocked'`。
- **小程序单机模式 KDF 参数修复（P1）**：小程序 WebCrypto 不支持 Argon2id，单机模式鉴权应使用 PBKDF2（`KDF_PARAMS_MOBILE`）。此前部分路径未传入移动端 KDF 参数，导致解锁失败。修复：`setupStandalone` / `unlockStandalone` / `recoverStandalone` 全部显式传入 `KDF_PARAMS_MOBILE`。
- **小程序 lock() 清理持久化 token（P1）**：lock() 此前未清除持久化的 access token，锁定后重启仍可能绕过解锁。修复：lock() 调用 `clearPersistedToken()`。
- **移动端自动保存死循环修复（P1）**：NoteEditScreen 的 useEffect 将 `save` 函数放入依赖数组，每次 note 更新都重建 save → 重新触发 effect → 死循环。修复：用 `useRef` 持有最新 save 函数，effect 依赖仅保留 `title` / `content`。
- **Web 键盘快捷键 Shift/Alt 修饰键修复（P1）**：`use-keyboard-shortcuts.ts` 此前只处理 Ctrl/Meta，导致 Ctrl+Shift+N（快速捕获）无法触发。修复：补全 Shift / Alt 修饰键识别。
- **Web NoteHistoryDialog Tauri origin 修复（P1）**：桌面端 `location.host` 为 `tauri.localhost`，相对路径 API 请求异常。修复：使用 `apiBase()` 构造绝对路径。
- **Web sync-ws URL 修复（P1）**：桌面端 WebSocket URL 使用 `location.host` 导致连接失败。修复：从 mode-store 读取 `serverUrl` 构造绝对 URL。
- **Web store.ts lock 清理 token（P1）**：lock() 清空 `accessToken` 防止锁定后请求继续带 token。

#### 服务端安全纵深（P1/P2）

- **进程级优雅关闭（P1）**：`index.ts` 新增 `uncaughtException` / `unhandledRejection` 处理器，触发 `shutdown()` 优雅关闭（含 shutdown guard 防重复），避免异常时数据损坏。
- **WebSocket DoS 防护（P1）**：`sync-ws.ts` 新增 `maxPayload`（64KB）、频道白名单校验（`ALLOWED_CHANNELS`）、单用户连接数限制（5）、消息速率限制（10/s）。
- **日志 URL 敏感参数脱敏（P2）**：`app.ts` 新增 `redactSensitiveUrl()`，对 URL query 中的 `password` / `token` / `access_token` / `refresh_token` / `secret` / `key` / `auth` 参数值替换为 `[REDACTED]`。
- **404 路径泄漏修复（P2）**：404 响应不再回显完整请求路径，改为通用提示。
- **WebSocket 连接限流（P2）**：新增按 IP 的 WS 连接速率限制。
- **GDPR 数据可携带性补齐（P0）**：`account.ts` 用户数据导出补齐 v2 加密列（`pw_salt` / `rc_salt` / `wrapped_master_key_pw` / `wrapped_master_key_rc`），确保导出后新实例可解密。
- **分享吊销事务化（P1）**：`shares.ts` 吊销操作包裹事务 + 审计日志。
- **笔记历史/版本端点 LIMIT（P2）**：`notes.ts` 历史与版本查询补 `LIMIT` 防 DoS。

### 涉及文件

- `miniprogram/src/state/auth.ts` — KDF_PARAMS_MOBILE + lock 清理 token
- `miniprogram/src/pages/standalone-setup/index.tsx` — 改用 auth store action
- `miniprogram/src/pages/standalone-unlock/index.tsx` — 改用 auth store action
- `miniprogram/src/pages/standalone-recover/index.tsx` — 改用 auth store action
- `mobile/src/screens/NoteEditScreen.tsx` — 自动保存 useRef 修复
- `web/src/lib/use-keyboard-shortcuts.ts` — Shift/Alt 修饰键
- `web/src/components/NoteHistoryDialog.tsx` — apiBase() 绝对路径
- `web/src/lib/sync-ws.ts` — serverUrl 构造 WS URL
- `web/src/lib/store.ts` — lock 清理 token
- `web/src/lib/io-client.ts` / `web/src/lib/remote-repo.ts` — 配套调整
- `server/src/index.ts` — 进程级优雅关闭
- `server/src/app.ts` — URL 脱敏 + 404 修复 + WS 限流
- `server/src/services/sync-ws.ts` — WS DoS 防护
- `server/src/routes/account.ts` — GDPR 导出补齐
- `server/src/routes/shares.ts` — 吊销事务化
- `server/src/routes/notes.ts` — LIMIT 防 DoS
- `server/src/middleware/version-check.ts` / `server/src/routes/auth.ts` / `server/src/routes/devices.ts` — 配套调整
- 全端版本号同步至 2.3.8（package.json ×7、tauri.conf.json、Cargo.toml、Android versionName、server env/update-manifest、mobile/miniprogram 源码内嵌 APP_VERSION、release.yml、smoke-test.sh）

## [2.3.7] - 2026-08-01

### 修复 — 首席架构师 SOP 零故障加固（服务端安全 + 设备吊销核心漏洞）

以四步 SOP（需求差异分析 → 深度代码扫描 → 静默修复 → 自动化验证闭环）对全端代码进行地毯式排查。经逐行核实源码（修正扫描 Agent 关于 IDOR 的误报——notes/tags/folders/shares/templates/preferences 路由全程 `WHERE user_id = ?`，越权访问复核通过），确认真实可修复缺口全部集中在服务端，共修复 8 项。

#### 安全红线（P0/P1）

- **设备吊销失效核心漏洞修复（P1）**：`devices.refresh_token_hash` 列此前**从不被写入**，导致设备吊销（`DELETE /devices/:id` 清空 `refresh_token_hash`）形同空操作——被吊销设备的 refresh token 仍能正常续签 access token。修复：`issueSession` 签发 refresh token 时写入其 SHA-256 哈希；`/auth/refresh` 改为恒定时间校验传入 token 哈希与库中存储值一致，并轮换更新哈希。吊销（清空哈希）后 refresh 立即失效。
- **JWT_SECRET 生产环境强制校验（P0）**：`server/src/env.ts` 此前对未设置 JWT_SECRET 静默回退开发默认值，生产环境若忘记配置即可被离线伪造任意 token。新增启动期校验：`NODE_ENV=production` 时，使用开发默认值或长度 < 32 直接拒绝启动。测试与开发环境不受影响。
- **/account/export 单独限流（P1）**：全量导出是重 IO 操作，此前无独立限流。新增按用户维度的限流（5 分钟最多 3 次，允许失败重试与多设备，同时阻止脚本化拉取）。

#### 数据可携带性（P0）

- **导出补齐 note_versions + note_tags（P0）**：`GET /account/export` 此前遗漏笔记历史版本表与笔记-标签关联表，导出后客户端无法重建笔记历史与多对多标签关系。补齐两表导出（`note_tags` 无 user_id 列，通过 JOIN notes 限定到当前用户）。

#### 纵深防御与细节（P2/P3）

- **countUserData 表名白名单（P2）**：`server/src/routes/account.ts` 表名拼接改为编译期常量集合 + `Set.has` 二次校验，杜绝 SQL 注入风险（虽原值来自常量已安全，但显式白名单更规范）。
- **logger 脱敏扩展（P2）**：`server/src/logger.ts` pino redact 路径补齐 `refresh_token_hash` / `masterKey` / `master_salt` / `pw_salt` / `rc_salt` / `auth_hash` / `recovery_hash` / `recovery_salt` / `password_hash` / `wrapped_master_key` / `shareKey` / `wrapped_share_key` / `secret` 及其通配形式。
- **export 显式列替代 SELECT \*（P3）**：folders/tags/preferences 导出改为显式列，避免未来新增内部字段时意外泄漏。

#### 细枝末梢核实结论（已确认无问题）

- **越权访问（IDOR）**：所有用户态表查询均带 `WHERE user_id = ?`（notes/folders/tags/shares/templates/preferences/devices/account），复核通过。
- **事务一致性**：notes PATCH 历史快照+清理+主表更新、notes restore、account delete/export、auth setup 均包裹 `db.transaction()`。
- **乐观锁**：notes PATCH / restore 校验 version 防并发覆盖。
- **入参校验**：所有路由均 zod 校验，无 `z.any()`；SQL 全部参数化。
- **速率限制**：全局 600/min、auth 20/15min、公开分享 60/min、export 3/5min。
- **CORS `!origin` 放行**：经分析为**有意设计**——微信小程序 `wx.request` 不发送 Origin 头，生产环境禁用会阻断小程序端。保留并已由现有注释说明（审计该项建议对本应用多端客户端不适用）。

### 涉及文件

- `server/src/env.ts` — JWT_SECRET 生产强制校验 + 版本号 2.3.7
- `server/src/auth/jwt.ts` — 新增 `hashRefreshToken` / `safeEqualHash`
- `server/src/routes/auth.ts` — issueSession 写入 refresh 哈希 + /auth/refresh 校验轮换
- `server/src/routes/account.ts` — countUserData 白名单 + export 补 note_versions/note_tags + 显式列
- `server/src/logger.ts` — 脱敏路径扩展
- `server/src/app.ts` — /account/export 限流
- 全端版本号同步至 2.3.7（package.json ×7、tauri.conf.json、Cargo.toml、Android versionCode 16→17 / versionName 2.3.5→2.3.7、server env/update-manifest、mobile/miniprogram 源码内嵌 APP_VERSION、release.yml）

## [2.3.6] - 2026-07-31

### 修复 — 跨平台三端 Bug 修复（安卓功能补全 + Windows 弹窗/菜单/更新 + 小程序白屏）

- **安卓端功能补全**：文件夹创建/删除/回收站操作迁移到 `createRepository` 工厂；标签编辑 UI（chips + 输入框 + 添加按钮）并加载/保存 tags；`NotesListScreen` 增加 `useFocusEffect` 修复标题修改后列表不刷新；`emptyTrash` 改为 `for...of` 顺序删除避免请求风暴；`use-update-check.ts` 实现 10s 超时 + `SettingsScreen` "检查更新"入口。
- **Windows 桌面端**：收藏/置顶图标点击无反应修复（`updateNote` 乐观更新补 `isPinned`/`isFavorite`）；检查更新超时卡死修复（updater 10s `Promise.race`）；编辑菜单英文改中文；原生 `confirm()`/`alert()` 替换为 `ConfirmDialog` + `toast.error()`。
- **微信小程序**：`app.tsx` 注册 `Taro.onError`/`onUnhandledRejection`/`onPageNotFound` 全局错误兜底修复白屏；`getApi()` 在 serverUrl 未配置时显式抛错；`app.config.ts` 主包 8 页 + 6 分包 + `preloadRule`；`networkTimeout` 配置。
- **桌面端恢复码流程修复**：`setup`/`setupStandalone`/`recoverStandalone` 不再自动设 `authState='unlocked'`，新增 `confirmSetupComplete()` 由用户确认已保存恢复码后再切 unlocked，避免恢复码界面被提前卸载。
- **加密修复**：`shared/src/crypto.ts` HMAC-SHA256 移动端改用 `createHmac`（react-native-quick-crypto JSI），web/小程序回退 `subtle.sign`，处理 `react-native-buffer` 的 `byteOffset`。
- **Android 平板适配**：`values-sw600dp`/`values-sw720dp` 尺寸资源 + `useResponsiveLayout` Hook。

### 涉及文件

- `mobile/src/screens/*.tsx`、`mobile/src/state/auth.ts`、`mobile/src/lib/use-update-check.ts`
- `web/src/components/{AboutDialog,SharesManager}.tsx`、`web/src/lib/i18n.ts`、`web/src/lib/use-keyboard-shortcuts.ts`
- `desktop/src-tauri/src/lib.rs`、`desktop/src-tauri/tauri.conf.json`
- `miniprogram/src/app.tsx`、`miniprogram/src/app.config.ts`、`miniprogram/src/state/auth.ts`
- `shared/src/crypto.ts`

## [2.3.5] - 2026-07-31

### 修复 — 安卓启动崩溃 "Cannot read property 'useRef' of null"（P0 根因修复）

v2.3.4 发布后用户仍反馈安卓启动即崩溃。经 CI 日志取证确认：v2.3.3/v2.3.4 的修复（polyfill require 化 + extraNodeModules 映射 + CI 条件符号链接）**均未触及根因**——双 React 物理实例依然存在。

#### 根因分析

pnpm `node-linker=hoisted` 布局下存在两份不同的 React 物理副本：

1. **根 `node_modules/react`**：pnpm hoisted 的物理目录（react-native 等原生模块经 hierarchical lookup 解析到此）
2. **`mobile/node_modules/react`**：pnpm 自动创建的 junction，指向 `.pnpm/react@18.2.0/node_modules/react`（pnpm virtual store 副本，App 代码经 `nodeModulesPaths` 优先解析到此）

两份副本虽版本相同（18.2.0），但物理路径不同 → Metro bundle 内出现两份 `ReactSharedInternals` 实例 → 组件用 A 实例创建、渲染器用 B 实例调度 → hook dispatcher 为 null → `useRef`/`useState` 等 hook 调用抛 "Cannot read property 'useRef' of null"。

**为什么之前的修复无效**：

- `extraNodeModules: { react: ... }` 仅在默认解析失败时作为 fallback 触发；当 `mobile/node_modules/react` 已存在（pnpm junction）时，Metro 直接命中本地副本，extraNodeModules 根本不执行
- CI `release.yml` 的 `if [ ! -e "mobile/node_modules/react" ]` 守卫——pnpm install 已创建 junction，守卫条件为假，符号链接步骤被跳过，pnpm store 副本残留
- v2.3.4 CI 构建日志确认：symlink 步骤的 `if` 条件未通过，react 链接未创建 → APK 内双 React 实例 → 崩溃

#### 修复方案（三层防御）

1. **`mobile/metro.config.js` — resolveRequest 显式拦截（核心修复）**
   在 resolver 入口添加自定义 `resolveRequest`，拦截所有 `react` 及 `react/*`（含 JSX transform 产生的 `react/jsx-runtime`、`react/jsx-dev-runtime`）导入，强制经 `require.resolve` 解析到 workspace root 的同一份实例。无论物理布局如何（junction 存在与否），均保证 bundle 内单一 React 实例。非 react 模块委托内置解析器（`context.resolveRequest`，非递归）。

2. **`.github/workflows/release.yml` — 强制重建 react 符号链接**
   移除 `[ ! -e ]` 守卫，改为 `rm -f` 先删除 pnpm 创建的 junction，再 `ln -s` 指向 root 的同一份 react。确保 CI 产物中 mobile 与 root 的 react 指向同一物理目录。

3. **本地 stale junction 修复**
   删除 `mobile/node_modules/react` 指向 pnpm store 的旧 junction，重建为指向 `node_modules/react`（root hoisted 副本），本地开发环境同样保证单一实例。

#### ErrorBoundary 增强

- 新增"显示详情"开关：可展开查看完整错误栈 + 组件栈（之前仅显示 4 行 error.message），便于无 adb 环境就地排查
- 新增"退出应用"按钮（`BackHandler.exitApp`）：重新加载无效时的兜底退出
- "复制日志"改为"输出日志"并明确提示通过 `adb logcat | grep DustNote` 查看（项目未链接 `@react-native-clipboard/clipboard`，无法真正写入剪贴板）

### 涉及文件

- `mobile/metro.config.js` — 新增 resolveRequest 强制 react 单实例解析
- `.github/workflows/release.yml` — 强制重建 react 符号链接 + fallback 版本号 v2.3.5
- `mobile/src/components/ErrorBoundary.tsx` — 显示详情/退出应用/输出日志增强
- 全端版本号同步至 2.3.5（Android versionCode 16）

## [2.3.4] - 2026-07-31

### 修复 — 全端产物审计与加固

以资深 QA + DevOps 视角对安卓、Windows 桌面、Web、iOS（静态）各端构建产物进行全面审计，修复潜在崩溃风险与配置缺陷，新增 Android 平板适配。

#### 安卓端

- **缺失 proguard-rules.pro 文件**（P1 潜在构建失败）：`build.gradle` 在 `release` buildType 中引用了 `proguardFiles ... "proguard-rules.pro"`，但源码树中该文件不存在。当前 `minifyEnabled=false` 不影响构建，若未来启用代码缩减/R8 会导致 `FileNotFoundException`。新建完整的 keep 规则文件，覆盖 React Native 核心（bridge/uimanager/fabric/turbomodule/soloader）、Hermes 引擎、JSI native 方法、所有 autolinked 第三方模块（keychain/biometrics/safe-area/fs/quick-crypto/gesture-handler/reanimated/screens/svg/navigation）、Parcelable CREATOR、Enum 方法、泛型签名。
- **平板适配缺失**（P2 体验缺陷）：无 `values-sw600dp` / `values-sw720dp` 资源目录，也无 JS 层响应式布局。新建 `values-sw600dp/dimens.xml`（7" 平板）和 `values-sw720dp/dimens.xml`（10"+ 平板）提供原生组件尺寸；新建 `useResponsiveLayout.ts` Hook 检测屏幕宽度并提供适配参数（isTablet / maxContentWidth / cardPadding / fontSize / useSplitView）；集成到 `NotesListScreen.tsx`（平板上限制内容宽度居中显示、增大间距与字号）。

#### Windows / 桌面端

- **托盘图标 unwrap() panic 风险**（P0 潜在崩溃）：`lib.rs` 第 291 行 `app.default_window_icon().unwrap().clone()` 在窗口图标缺失（配置异常或资源加载失败）时会 panic 导致应用启动崩溃。改为条件赋值模式：图标存在则 `.icon(icon.clone())`，不存在则打印警告并跳过，托盘使用系统默认图标仍可正常工作。

#### iOS 端

- 确认无 iOS 项目目录（仅 Tauri 代码中有 `#[cfg(target_os = "ios")]` 占位 stub）。iOS 暂不支持，无需修复，列入后续计划。

#### 共性问题

- **无调试代码残留**：全项目 `console.log` 仅存在于 `diagnostics.ts` 诊断工具（按日志级别路由，非调试残留）；Rust 代码仅剩 `.expect()` on `.run()`（Tauri 标准模式，无法优雅恢复）。
- **依赖与缓存**：pnpm hoisted node-linker 配置正确；`.npmrc`、`pnpm-workspace.yaml`、`.gitignore` 配置完整。
- **配置文件**：`AndroidManifest.xml` 权限声明齐全（INTERNET / ACCESS_NETWORK_STATE / USE_BIOMETRIC / USE_FINGERPRINT / READ_EXTERNAL_STORAGE maxSdkVersion=32 / RECEIVE_BOOT_COMPLETED）；`networkSecurityConfig` 正确限制明文流量至 localhost + 10.0.2.2；`usesCleartextTraffic=true` 为 API 23 向后兼容保留（networkSecurityConfig 在 API 24+ 覆盖此值）。

### 涉及文件

- `mobile/android/app/proguard-rules.pro` — 新建 ProGuard keep 规则
- `mobile/android/app/src/main/res/values-sw600dp/dimens.xml` — 新建 7" 平板尺寸
- `mobile/android/app/src/main/res/values-sw720dp/dimens.xml` — 新建 10" 平板尺寸
- `mobile/src/lib/useResponsiveLayout.ts` — 新建响应式布局 Hook
- `mobile/src/screens/NotesListScreen.tsx` — 集成平板适配
- `desktop/src-tauri/src/lib.rs` — 修复 unwrap() panic 风险
- 全端版本号同步至 2.3.4（Android versionCode 15）

## [2.3.3] - 2026-07-31

### 修复 — v2.3.2 用户反馈问题批量修复

针对 v2.3.2 发布后用户反馈的 7 项问题进行逐一排查与修复。本次重点解决安卓端 React 实例冲突导致的启动崩溃、桌面端锁定/置顶/收藏按钮无响应、原生 alert/confirm 弹窗阻塞 UI 等关键体验问题。

#### 安卓端

- **安卓启动崩溃 "Cannot read property 'useRef' of null"**（P0）：`mobile/polyfill.js` 中 `import { install } from 'react-native-quick-crypto'` 为静态 import，ES module 会在所有后续 import（含 React）之前执行；当 quick-crypto 的 JSI 绑定缺失或 CMake 未编译时，模块加载异常冒泡到 index.js，导致 React 本身加载失败 → `useRef` 等 hook 为 null。改为 `require()` + 双层 try/catch（外层捕获模块加载错误，内层捕获 install 错误），确保即使 crypto 完全不可用 App 也能启动。同时 `metro.config.js` 显式映射 `react` 到 workspace root 的同一份实例，避免 pnpm hoisted 布局下不同原生模块解析到不同 React 副本。CI `release.yml` 新增 react 符号链接步骤，确保 `mobile/node_modules/react` 优先于其他原生模块链接。

#### 桌面端 / Web

- **无法锁定，点击没反应**（P0）：`App.tsx` 中存在一个自动 grace unlock useEffect，`lock()` 后 authState 变为 `needs_unlock` 时立即自动调用 `graceUnlock()` 恢复 unlocked 状态，导致 lock 按钮看起来"点了没反应"。移除该自动 effect，改为在 `UnlockScreen` / `StandaloneUnlockScreen` 中提供手动"⚡ 继续使用（免密）"按钮，宽限期内用户可主动选择免密恢复。
- **编辑选项列表中文模式还是英文**（P1）：`store.ts loadAll()` 从 SQLite 加载偏好后只更新 `preferences.language` 状态，未调用 `i18n.changeLanguage()` 让运行时 i18n 实例同步切换。补全 `i18n.changeLanguage()` 调用，同时写入 `dustnote_language` localStorage key 保证刷新后一致。
- **关于信息弹窗卡住无法关闭**（P0）：`App.tsx about()` 使用原生 `alert()`，Tauri webview 中 alert 会阻塞主线程导致界面卡死、无法关闭。新建 `AboutDialog.tsx` 组件，提供样式化 modal（支持 Esc / 点击遮罩关闭），替换原生 alert。
- **删除弹窗样式优化**（P1）：`Editor.tsx` 和 `Sidebar.tsx` 使用原生 `confirm()`，样式与主题不一致且在桌面端可能阻塞。新建 `ConfirmDialog.tsx` 组件（支持 danger/default 两种 variant、Esc/遮罩关闭），替换所有 `confirm()` 调用：单条删除、永久删除、批量删除、批量永久删除、清空回收站。
- **置顶/收藏图标点击没反应**（P1）：`Editor.tsx` 中 pin/favorite 按钮的 `onClick` 直接调用 `updateNote()`（返回 Promise）但未用 `void` 标记，React 事件处理器中的 floating Promise 在严格模式下可能被吞掉。补 `void` 前缀确保 Promise 正常执行。
- **检查更新操作超时（10000ms）界面卡住**（P1）：`SettingsDialog.tsx` 打开时自动调用 `checkForUpdates()` 网络请求，国内访问 GitHub Releases 慢/不稳时最多卡顿 10s。改为打开时仅检查本地磁盘的 `getPendingUpdate()`（毫秒级），网络检查改为用户主动点击"🔍 检查更新"按钮触发，所有 Tauri IPC 调用均带 `withTimeout` 超时保护（5s/10s/600s/15s 分级）。

### 涉及文件

- `mobile/polyfill.js` — 静态 import 改 require + 双层 try/catch
- `mobile/metro.config.js` — 显式映射 react 到 workspace root 实例
- `.github/workflows/release.yml` — CI 新增 react 符号链接 + fallback 版本号更新至 v2.3.3
- `web/src/App.tsx` — 移除自动 grace unlock effect + 接入 AboutDialog
- `web/src/components/AboutDialog.tsx` — 新建样式化关于弹窗
- `web/src/components/ConfirmDialog.tsx` — 新建样式化确认弹窗
- `web/src/components/Editor.tsx` — pin/favorite onClick 补 void + 删除改用 ConfirmDialog
- `web/src/components/Sidebar.tsx` — 批量删除/清空回收站/单条永久删除改用 ConfirmDialog
- `web/src/components/SettingsDialog.tsx` — 移除自动网络检查更新 + 全部 IPC 加超时保护
- `web/src/lib/store.ts` — loadAll 同步 i18n.changeLanguage
- `web/src/lib/i18n.ts` — 新增 locked_retry 翻译 key

## [2.3.2] - 2026-07-30

### 修复 — v2.3.1 用户反馈问题批量修复

针对 v2.3.1 发布后用户反馈的 11 项问题进行逐一排查与修复，并同步扫描全项目类似细节错误。

#### 安卓端

- **安卓启动闪退**（P0）：`mobile/polyfill.js` 中 `react-native-quick-crypto` 的 `install()` 未包裹 try/catch，部分设备/架构下 install 抛异常导致应用启动即白屏崩溃。补 try/catch 后即使 crypto 不可用也能启动并展示 ErrorBoundary。

#### 桌面端 / Web

- **初始设置不显示恢复码**（P0）：`store.ts` 的 `setup()` / `setupStandalone()` 在返回 recoveryCode 前就设置 `authState: 'unlocked'`，导致 App.tsx 立即切换到主界面、SetupScreen 被卸载、恢复码永远不显示。移除 setup 中的 `authState: 'unlocked'` 设置，改为 reload 后由 checkStatus 自然过渡到 needs_unlock。
- **笔记无法解锁**（P0）：`lock()` 清空 masterKey 后未将 authState 切回 `'needs_unlock'`，导致用户卡在主界面但笔记无法解密。补充 `authState: 'needs_unlock'`，并在 App.tsx 新增宽限期免密解锁自动检查（authState 变为 needs_unlock 时自动尝试 graceUnlock）。
- **分享界面关闭无响应 + JSON 解析错误**（P0）：`SharesManager.tsx` 和 `Editor.tsx ShareDialog` 使用相对路径 `/api/v1/shares`，Tauri webview 会请求资源服务器返回 HTML 导致 "Unexpected token '<'" 错误。改用 mode-store 的 serverUrl 拼接绝对地址。底部"关闭"从纯文本改为可点击 button。
- **检查更新超时 + 卡顿**（P1）：`use-update-check.ts` 无超时保护，服务端不可达时无限等待导致 UI 卡顿。新增 10s AbortController 超时，并从 mode-store 获取 apiBase 拼接绝对地址。单机模式（无服务器）下跳过 web 更新检查，由 Velopack 负责桌面端更新。
- **新建文件夹无确定按钮**（P1）：`Sidebar.tsx` 新建文件夹输入框只有 Enter/Esc 键支持，无视觉确认按钮。补充 ✓ 确认按钮和 ✕ 取消按钮。
- **笔记移动逻辑错误**（P1）：`Sidebar.tsx` 批量移动使用 `prompt()` 要求用户输入文件夹 ID（用户不知道 ID，也不支持输入文件夹名称）。改为弹出文件夹选择对话框，列出所有现有文件夹供选择。
- **右键操作不支持**（P1）：`main.tsx` 和 `lib.rs` 全局拦截 contextmenu 事件，导致 input/textarea/contenteditable 中无法使用右键菜单（剪切/复制/粘贴/全选）。改为选择性拦截：仅在非编辑元素上 preventDefault。
- **编辑选项列表 i18n 英文**（P1）：`store.ts setPreferences()` 修改语言时只调用 `i18n.changeLanguage()` 但不更新 `dustnote_language` localStorage key，导致刷新后语言回退。补全 localStorage 持久化，并在 store 创建后同步 i18n 初始语言。
- **环境迁移多余关闭按钮**（P2）：`MigrationWizard.tsx` 底部有一个冗余的关闭按钮，与模态框自带关闭功能重复。移除冗余按钮。
- **自动更新版本回退**（P1）：`release.yml` 中 RELEASE_TAG 和 VPK_VERSION 的 fallback 值过期（v2.2.0 / v2.3.0），更新为 v2.3.2。

### 全项目类似错误扫描

- 扫描所有 `fetch('/api/v1/...')` 相对路径调用 — 已全部修复（SharesManager + Editor ShareDialog）
- 扫描所有 `prompt()` 滥用 — Editor.tsx 的 saveAsTemplate prompt 为合理的文本输入用途，保留
- 扫描所有 contextmenu blanket prevention — 已全部改为选择性拦截

## [2.3.1] - 2026-07-30

### 修复 — 生产级零故障加固（首席架构师 SOP 扫描）

本次以「零故障生产级系统」为目标，对服务端事务一致性、并发竞态、数据可携带性、纵深防御进行地毯式扫描与静默修复。typecheck + lint 全绿，196 项测试通过（shared 57 + server 71 + web 68）。全端版本号同步至 2.3.1（含 7 个 package.json、tauri.conf.json、Cargo.toml、Android versionCode 11→12 / versionName、server env / update-manifest、mobile & miniprogram 源码内嵌 APP_VERSION）。

#### 逻辑健壮性 — 事务回滚

- **notes PATCH 缺事务**（P1）：历史快照插入 + 旧版本清理 + 主表更新改为单事务原子执行，避免「快照已写但笔记未更新」或「版本被清理但快照未插入」的不一致。见 [server/src/routes/notes.ts](./server/src/routes/notes.ts)
- **notes restore 缺事务**（P1）：当前密文快照 + 历史密文覆盖改为事务原子化，避免恢复过程中断导致数据不一致
- **shares create 缺事务**（P1）：分享写入 + 审计日志原子化，避免审计缺失或分享残留

#### 逻辑健壮性 — 并发锁机制

- **auth setup 竞态**（P1）：`loadUser()` 检查与用户写入移入同一事务，消除两个并发 setup 请求双双通过检查、双双插入的竞态。见 [server/src/routes/auth.ts](./server/src/routes/auth.ts)
- **flushQueue 重入**（P1）：离线队列重放加模块级 `flushingRef` 守卫，串行化 online 事件 + 用户手动同步触发的并发重放，避免 peek 到同一批 op 重复执行导致笔记重复创建 / 版本冲突。见 [web/src/lib/store.ts](./web/src/lib/store.ts)
- **编辑器并发保存**（P1）：autoSave 防抖与 Ctrl+S 立即保存加 `savingInFlight` 守卫，避免并发写同一笔记触发服务端 409 版本冲突丢失更新。见 [web/src/components/Editor.tsx](./web/src/components/Editor.tsx)

#### 安全红线 — 数据可携带性

- **account/export 漏导出笔记密文**（P1）：原查询只导出笔记元数据，与 GDPR Article 20「数据可携带权」及文档承诺矛盾。修复后补全 `ciphertext / key_version / folder_id / server_updated_at`，并新增 `shares`、`templates` 导出，实现完整数据迁移。见 [server/src/routes/account.ts](./server/src/routes/account.ts)
- **account/export 误导出凭据哈希**（P2）：原 `SELECT *` 会把 `users.password_hash / master_salt / recovery_hash / recovery_salt` 与 `devices.refresh_token_hash` 一并导出。这些服务端凭据校验产物对迁移无价值（换服务器后重设密码即重新生成），却会在导出文件泄漏时构成离线爆破面。改为显式列：仅保留 `wrapped_master_key`（迁移后用主密码重新解开笔记的唯一凭证）等迁移必需字段，剔除全部哈希/盐。

#### 安全红线 — 纵深防御

- **devices UPDATE 缺 user_id**（P2）：吊销设备 UPDATE 语句补 `AND user_id = ?`，即便上层 SELECT 之外发生并发变更，也不会误改他用户设备。见 [server/src/routes/devices.ts](./server/src/routes/devices.ts)

#### 扫描结论（已确认无问题项）

- 加密参数：Argon2id m=64MB/t=3/p=4 与文档一致；AES-GCM-256 + AAD 绑定；masterKey 零化；常量时间比较 ✓
- 入参校验：所有路由均 zod 校验；SQL 全部参数化 ✓
- 越权访问：notes/folders/tags/shares/devices/account 均校验 `user_id` 归属 ✓
- 速率限制：全局 600/min、auth 20/15min、公开分享 60/min ✓
- 日志脱敏：无 password/token/masterKey 泄漏；错误响应生产环境脱敏 ✓
- 乐观锁：笔记更新 / 恢复均校验 version 防并发覆盖 ✓

## [2.3.0] - 2026-07-30

### 新增 — 懒人化体验 & 异常自我修复

本次发布以「极客用户 & 效率专家」视角，聚焦提升日常使用爽感、降低个人项目维护成本。所有建议已逐一实现并通过 typecheck / lint / 68 项测试验证。

#### 1. 懒人化体验

- **命令面板 Ctrl+K**（A-7）：[web/src/components/CommandPalette.tsx](./web/src/components/CommandPalette.tsx) 模糊搜索 + 键盘导航，一键触达新建/锁定/主题/模式等命令
- **Quick Capture 快速捕获**（S-3）：`Ctrl+Shift+N` 唤起极简浮层，灵感即写即存，不干扰当前编辑
- **编辑器拖拽 / 粘贴图片**（S-2）：[web/src/lib/image-paste.ts](./web/src/lib/image-paste.ts) canvas 压缩（长边 1600px、JPEG 0.82、透明 PNG 保留）内联为 data URL，sanitize-html 已放行
- **语音输入**（B-8）：[web/src/components/VoiceInputButton.tsx](./web/src/components/VoiceInputButton.tsx) 基于 Web Speech API，实时听写插入光标处
- **剪贴板 / URL 模板**（B-9）：编辑器 📎 按钮读取剪贴板，URL 自动转 Markdown 链接；新增 `tpl-bookmark` 书签预设模板
- **桌面端免密解锁宽限期**（S-1）：[web/src/lib/grace-unlock.ts](./web/src/lib/grace-unlock.ts) 锁定后 30 分钟内可一键恢复（仅桌面端、仅内存、可关闭）

#### 2. 数据主权与迁移

- **环境迁移向导**（A-6）：[web/src/components/MigrationWizard.tsx](./web/src/components/MigrationWizard.tsx) 导出/导入 `dustnote-env.json`（主题、模式、服务器地址），换电脑/重装一键恢复
- **每日静默自动备份**（S-4）：[web/src/lib/auto-backup.ts](./web/src/lib/auto-backup.ts) 滚动保留最近 N 份客户端数据快照
- **服务端 SQLite 自动备份**（P0-3）：[server/src/scripts/backup.ts](./server/src/scripts/backup.ts) 在线 backup + 滚动清理（`BACKUP_DIR` / `BACKUP_RETENTION` 环境变量配置）

#### 3. 异常自我修复

- **离线队列指数退避重试**（P0-4）：[web/src/lib/offline-queue.ts](./web/src/lib/offline-queue.ts) `MAX_RETRIES=8`，`delay=min(30s, 1s·2^attempt)+jitter`，网络故障自动重放
- **客户端诊断日志**（P0-2）：[web/src/lib/diagnostics.ts](./web/src/lib/diagnostics.ts) 环形缓冲 + 脱敏 + 一键导出，个人项目无外部监控也能取证
- **Web ErrorBoundary**（P1-3）：[web/src/components/AppErrorBoundary.tsx](./web/src/components/AppErrorBoundary.tsx) 捕获渲染异常，展示用户错误码 + 诊断导出，杜绝白屏
- **IndexedDB 容量监控 + 清理**（P0-1）：[web/src/components/DiagnosticsPanel.tsx](./web/src/components/DiagnosticsPanel.tsx) 存储用量进度条、阈值警告、一键清理离线队列/日志/旧备份

#### 4. 轻量化与防坑

- **CI bundle 体积监控**（P1-2）：[.github/workflows/ci.yml](./.github/workflows/ci.yml) 构建后检查 `web/dist` 体积，超 5MB 告警
- **Docker arm64 多架构**（P2-1）：CI 支持 `linux/amd64,linux/arm64`，可部署树莓派等 ARM 设备
- **.gitattributes 消除 CRLF**（P1-1）：统一 LF 行尾，Windows 本地 format:check 与 Linux CI 一致
- **quick-crypto 体积标注**（P2-2）：[mobile/README.md](./mobile/README.md) 记录原生依赖体积取舍（8–12MB vs Argon2id 200ms 性能）

### 移动端

- 生物识别解锁 UI（A-5）：[mobile/src/screens/StandaloneUnlockScreen.tsx](./mobile/src/screens/StandaloneUnlockScreen.tsx) 已对接 keychain 缓存 masterKey，指纹/面容一键解锁

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
- [web/src/screens/PublicShareView.tsx](./web/src/screens/PublicShareView.tsx)：硬编码 '0.1.0' 改为 **APP_VERSION**

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

| 跳过项                   | 原因                          | 影响                                       |
| ------------------------ | ----------------------------- | ------------------------------------------ |
| iOS 构建                 | 需 macOS + Xcode + Apple 签名 | iOS 无安装包；RN 代码已编写，未来可构建    |
| macOS 桌面 vpk pack 实测 | 需 macOS 硬件                 | release.yml 已有 `continue-on-error: true` |

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
