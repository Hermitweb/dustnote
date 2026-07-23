# DustNote · 尘心笔记

> 🌿 极简 · 清新 · 跨端 · 安全——一款 E2EE 端到端加密的个人笔记系统

![Status](https://img.shields.io/badge/status-v0.1.0--alpha-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-20%2B-blue)
![E2EE](https://img.shields.io/badge/encryption-AES--256--GCM-purple)
![Platforms](https://img.shields.io/badge/platforms-5-brightgreen)

## 特性

- 🔐 **端到端加密**——AES-256-GCM，服务端仅存密文，完全看不到明文
- 📝 **Markdown 编辑器**——左编辑右预览，所见即所得
- 🎨 **6 套主题 × 亮暗双模式**——薄荷绿 / 月光蓝 / 日落橙等 12 套皮肤
- 📥📤 **导入导出**——支持 .txt / .md / .docx 导入；导出 Markdown / HTML / JSON 备份
- 🔗 **分享笔记**——生成独立链接，可设密码和有效期
- 📁 **文件夹 + 标签**——自由组织笔记结构
- ✅ **多选批量操作**——长按选择多条笔记，一键移动/置顶/收藏/删除
- 🔄 **实时同步**——WebSocket 推送，1 秒内同步到所有在线设备
- 📱 **跨平台**——Web / 桌面 (Windows/macOS/Linux) / Android / iOS / 微信小程序
- 🐳 **一键部署**——Docker Compose，5 分钟上线

## 平台覆盖

| 平台               | 状态 | 构建方式                 | 分发                  |
| ------------------ | ---- | ------------------------ | --------------------- |
| **Web**            | ✅   | Vite                     | 静态文件 / Docker     |
| **桌面** (Tauri 2) | ✅   | `pnpm build:desktop`     | .msi/.dmg/.deb 安装包 |
| **微信小程序**     | ✅   | `pnpm build:miniprogram` | 微信审核上传          |
| **H5 移动版**      | ✅   | `pnpm build:h5`          | 静态文件部署          |
| **Android**        | ✅   | `pnpm build:android`     | APK 分发              |
| **iOS**            | ✅   | `pnpm build:ios`         | App Store             |

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org) 20 LTS+
- [pnpm](https://pnpm.io) 9.x+

### 本地开发

```bash
# 1. 安装依赖
pnpm install

# 2. 启动后端 + Web 端 + 桌面端
pnpm dev

# 3. 单独启动小程序 H5 版（可选）
cd miniprogram && NODE_OPTIONS=--openssl-legacy-provider pnpm dev:h5

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

- [产品需求文档 (PRD)](./.trae/documents/PRD.md)
- [技术架构](./.trae/documents/tech-architecture.md)
- [安全规范](./.trae/documents/security.md)
- [主题系统](./.trae/documents/theme-system.md)
- [数据流与导入导出](./.trae/documents/data-flow.md)
- [更新通道设计](./.trae/documents/update-strategy.md)
- [研发路线图](./.trae/documents/roadmap.md)
- [生产就绪状态](./.trae/documents/production-readiness.md)

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
