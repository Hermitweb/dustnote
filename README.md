# DustNote · 尘心笔记

> 🌿 极简 · 清新 · 跨端 · 安全——一款 E2EE 端到端加密的个人笔记系统

![Status](https://img.shields.io/badge/status-v2.4.4-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-20%2B-blue)
![E2EE](https://img.shields.io/badge/encryption-AES--256--GCM-purple)
![Platforms](https://img.shields.io/badge/platforms-5-brightgreen)
![Modes](https://img.shields.io/badge/modes-standalone%20%2F%20online-teal)

## 特性

- 🔐 **端到端加密**——AES-256-GCM，服务端仅存密文，完全看不到明文
- 🏠 **单机/联机双模式**——v2.0.0 新增：无服务器也能独立运行（单机模式），连接服务器解锁跨设备同步（联机模式）
- 📝 **Markdown 编辑器**——左编辑右预览，所见即所得
- 🎨 **6 套主题 × 亮暗双模式**——薄荷绿 / 月光蓝 / 日落橙等 12 套皮肤
- 📥📤 **导入导出**——支持 .txt / .md / .docx 导入；导出 Markdown / HTML / PDF / JSON 备份
- 🔗 **分享笔记**——生成独立链接，可设密码和有效期（联机模式）；单机模式支持文件导出分享
- 📁 **文件夹 + 标签**——自由组织笔记结构
- ✅ **多选批量操作**——长按选择多条笔记，一键移动/置顶/收藏/删除
- 🔄 **实时同步**——WebSocket 推送，1 秒内同步到所有在线设备（联机模式）
- 📱 **跨平台**——Web（支持 PWA 安装） / 桌面 (Windows/macOS/Linux) / Android / iOS / 微信小程序
- 🐳 **一键部署**——Docker Compose，5 分钟上线（自托管服务器）
- 🔄 **自动更新**——桌面端 Velopack 增量更新；Windows 提供 MSI（默认 Program Files，支持自定义路径与静默部署）

## 双模式架构（v2.0.0 新增）

DustNote v2.0.0 引入**单机/联机双模式架构**，让客户端在完全没有服务器的情况下也能独立运行。

| 能力                 | 单机模式（standalone）                                            | 联机模式（online）                          |
| -------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| 主密码 setup/unlock   | 本地 Argon2id + 比对（无 JWT）                                    | 调 `/auth/setup`、`/auth/unlock`             |
| 笔记/文件夹/标签 CRUD | LocalRepository（IndexedDB / AsyncStorage / Taro.setStorage）     | RemoteRepository（API + 离线队列）          |
| 分享                 | **仅文件导出**（txt / md / html / pdf）                           | 在线分享链接 + 文件导出                     |
| 跨设备同步           | **不支持**                                                        | WebSocket + 离线队列                        |
| 设备管理             | **不支持**（UI 隐藏）                                             | 支持                                        |
| 服务端依赖           | 无                                                                | 必需                                        |

**模式切换**：支持 standalone ↔ online 一键迁移，数据不丢失（详见 [standalone-mode.md](./.trae/documents/standalone-mode.md)）。

**关键设计**：

- masterKey 随机生成 + 双重包装（passwordWrappedMasterKey + wrappedMasterKey）
- recover 后 masterKey 保留，笔记密文无需重加密
- 客户端锁定（6 次失败锁 15 分钟）防止离线爆破

## 平台覆盖

| 平台               | 状态 | 构建方式                 | 分发                  |
| ------------------ | ---- | ------------------------ | --------------------- |
| **Web**（PWA）     | ✅   | Vite                     | 静态文件 / Docker / PWA 安装 |
| **桌面** (Tauri 2) | ✅   | `pnpm build:desktop`     | Windows MSI + Setup.exe / Linux 桌面集成包 |
| **微信小程序**     | ✅   | `pnpm build:miniprogram` | 微信审核上传          |
| **H5 移动版**      | ✅   | `pnpm build:h5`          | 静态文件部署          |
| **Android**        | ✅   | `pnpm build:android`     | APK 分发              |
| **iOS**            | ⚠️ 跳过 | 需 macOS + Xcode        | RN 代码已编写，未来可构建 |

> macOS 桌面 vpk pack 实测需 macOS 硬件，release.yml 已有 `continue-on-error: true`。

## 快速开始

DustNote 提供两种使用模式，无需任何配置即可选择：

### 模式 A：单机使用（无需服务器）

1. 下载客户端安装包（或访问 Web 端）
2. 首次启动选择「🏠 单机使用」
3. 设置主密码 + 抄写恢复码
4. 开始使用，数据存储在本地（IndexedDB / AsyncStorage / Taro.setStorage）

> **单机模式特点**：零服务器依赖、隐私优先、设备丢失则数据丢失（建议定期导出 ZIP 备份）

### 模式 B：连接服务器（联机模式）

1. **部署服务器**（详见 [DEPLOY.md](./DEPLOY.md)）：

   ```bash
   cp .env.example .env
   # 编辑 .env，填写 JWT_SECRET 和你的域名
   docker compose up -d --build
   curl http://localhost:8080/api/v1/health
   ```

2. **客户端连接**：首次启动选择「🌐 连接服务器」→ 输入服务器地址 → 设置主密码

> **联机模式特点**：跨设备同步、在线分享、服务端定期备份

### 模式切换

支持 standalone ↔ online 一键迁移，数据不丢失：

- 单机 → 联机：上传数据到服务器
- 联机 → 单机：下载数据到本地

详见 [standalone-mode.md §7](./.trae/documents/standalone-mode.md)。

### 前置条件（开发者）

- [Node.js](https://nodejs.org) 20 LTS 或 22 LTS（**勿用 Node 24**：better-sqlite3 11.x 未适配其 V8 API，运行时崩溃）
- [pnpm](https://pnpm.io) 9.x+
- Windows 开发需安装 Python 3 与 Visual Studio Build Tools（用于编译 `better-sqlite3`）
- 构建 Android 需安装 [Android Studio](https://developer.android.com/studio) 与 Android SDK 34（详见 [mobile/README.md](./mobile/README.md)）
- 构建桌面安装包需安装 [Rust](https://www.rust-lang.org/tools/install) 与 Tauri 依赖（详见 [desktop/README.md](./desktop/README.md)）

### 本地开发

```bash
# 1. 安装依赖
pnpm install

# 2. 启动后端 + Web 端 + 桌面端
pnpm dev

# 3. 单独启动小程序 H5 版（可选）
pnpm dev:h5

# 打开浏览器访问
# Web: http://localhost:5173
# 小程序 H5: http://localhost:10086
# API: http://localhost:3210/api/v1/health
```

### 生产部署（Docker）

```bash
# 1. 配置环境变量
cp .env.example .env
# 编辑 .env，填写你的域名

# 2. 一键启动
docker compose up -d --build

# 3. 检查服务
curl http://localhost:8080/api/v1/health
```

完整部署文档见 [DEPLOY.md](./DEPLOY.md)（含 Docker Compose / 手动部署 / 反向代理 / HTTPS / 备份恢复 / 升级 / 故障排查）。

### 手动部署（无 Docker）

```bash
# 1. 构建
pnpm build:shared && pnpm build:server && pnpm build:web

# 2. 启动服务端
cd server
NODE_ENV=production DB_PATH=./data/dustnote.db WEB_ORIGIN=https://your-domain.com node dist/index.js

# 3. 部署 Web 静态文件（用 nginx 反代）
# web/dist/ → nginx 静态根目录
# /api/*  → localhost:3210 反代
```

## 项目结构

```
dustnote/
├── shared/           # 跨端共享（加密/API/类型），纯 JS
├── server/           # 后端 (Express + SQLite + WebSocket)
├── web/              # Web 端 (React + Vite + Tailwind)
├── desktop/          # 桌面端 (Tauri 2，复用 web/)
├── mobile/           # 移动端 (React Native)
├── miniprogram/      # 小程序 (Taro 3，多平台)
├── deploy/           # 部署配置 (nginx + supervisor)
├── Dockerfile        # 多阶段 Docker 构建
├── docker-compose.yml
└── .trae/documents/  # 产品/技术文档（PRD/架构/安全等）
```

## 功能

### 笔记管理

- 新建、编辑、删除、回复笔记
- 设为收藏 ⭐ / 置顶 📌 / 移动到文件夹 📁
- Markdown 实时预览
- 自动保存（1.5s 防抖）
- 版本冲突检测

### 多选批量操作

- 长按进入多选模式（小程序）/ 点击「选择」按钮（Web）
- 批量移动、置顶、收藏、删除
- 回收站批量恢复 / 彻底删除
- 分享管理批量吊销

### 端到端加密 (E2EE)

- Argon2id 派生主密钥 (m=64MB, t=3, p=4)
- AES-256-GCM 加密每条笔记
- 服务端零明文，数据泄露不影响安全
- 6 位恢复码可找回主密码

### 多端同步

- WebSocket 实时推送（<1s 延迟）
- 跨设备即时同步
- 同账号任意平台无缝衔接

### 部署管理

- Web 端内置部署管理页面（顶栏 🛠️ 按钮）
- 配置 API 地址后下载各平台免配置文件
- 应用内设置可随时修改服务器地址

## 构建与分发

```bash
pnpm build:web          # Web 静态文件 → web/dist/
pnpm build:desktop      # 桌面安装包 → desktop/src-tauri/target/release/bundle/
pnpm build:miniprogram  # 微信小程序 → miniprogram/dist/
pnpm build:h5           # H5 移动版 → miniprogram/dist/
pnpm build:android      # Android APK
pnpm build:ios          # iOS (仅 macOS)
pnpm docker:up          # Docker 部署
```

## 技术栈

| 层     | 技术                                               |
| ------ | -------------------------------------------------- |
| 加密   | Argon2id + AES-256-GCM (@noble/hashes, Web Crypto) |
| 前端   | React 18 + Vite 5 + Tailwind CSS 3 + Zustand       |
| 桌面   | Tauri 2 (Rust)                                     |
| 移动   | React Native 0.74                                  |
| 小程序 | Taro 3.6 + React                                   |
| 后端   | Express 4 + better-sqlite3 + WebSocket (ws)        |
| 部署   | Docker + Nginx                                     |

## 文档

### 产品与技术文档（`.trae/documents/`）

- [产品需求文档 (PRD)](./.trae/documents/PRD.md)
- [技术架构](./.trae/documents/tech-architecture.md)
- [单机模式说明](./.trae/documents/standalone-mode.md)（v2.0.0 新增）
- [安全规范](./.trae/documents/security.md)
- [主题系统](./.trae/documents/theme-system.md)
- [数据流与导入导出](./.trae/documents/data-flow.md)
- [更新通道设计](./.trae/documents/update-strategy.md)
- [Velopack 集成](./.trae/documents/integrate-velopack.md)
- [研发路线图](./.trae/documents/roadmap.md)
- [生产就绪状态](./.trae/documents/production-readiness.md)
- [v1.1 中低优先级任务](./.trae/documents/v1.1-medium-low-priority.md)
- [v2.0.0 双模式架构规划](./.trae/documents/v2.0.0-dual-mode-architecture.md)

### 用户与运维文档

- [用户使用手册](./docs/user-guide.md)
- [安装与卸载指南](./docs/installation-guide.md)（v2.4.0 新增，覆盖全平台安装/卸载/静默部署/自动更新）
- [常见问题 FAQ](./docs/faq.md)
- [自托管指南](./docs/self-hosting.md)
- [兼容性矩阵](./docs/compatibility-matrix.md)
- [服务状态](./docs/status.md)
- [运维手册](./docs/operations-runbook.md)
- [上线检查单](./docs/production-checklist.md)
- [隐私政策](./docs/privacy-policy.md)
- [服务条款](./docs/terms-of-service.md)
- [Cookie 政策](./docs/cookie-policy.md)

### 部署文档

- [DEPLOY.md](./DEPLOY.md) — 完整服务端部署文档（v2.0.0 新增）
- [deploy/README.md](./deploy/README.md) — 部署配置说明

### 更新日志

- [CHANGELOG.md](./CHANGELOG.md) — v2.4.0 全端安装/卸载/部署规范化 + 品牌统一；v2.0.0 单机/联机双模式架构

## 开发

```bash
pnpm install         # 安装依赖
pnpm dev             # 启动开发环境
pnpm typecheck       # 全量类型检查
pnpm build           # 构建所有包
pnpm clean           # 清理构建产物
```

## 贡献

欢迎提交 PR 和 Issue。

安全问题请邮件联系，**不要**在公开 Issue 中报告。

## 许可证

[MIT](./LICENSE)
