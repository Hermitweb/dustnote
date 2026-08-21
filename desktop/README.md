# DustNote Desktop (Tauri 2)

> 基于 Tauri 2 + React 18 的 DustNote 桌面端

## 目录结构

```
desktop/
├── src/                    # React 前端
│   ├── App.tsx             # 主入口
│   ├── main.tsx            # 渲染挂载
│   ├── lib/                # 工具层
│   └── index.css           # 全局样式
├── src-tauri/              # Rust 原生层
│   ├── src/
│   │   ├── lib.rs          # 托盘 + 启动项 + 全局快捷键
│   │   └── main.rs         # 入口
│   ├── Cargo.toml          # Rust 依赖
│   ├── tauri.conf.json     # Tauri 配置
│   ├── capabilities/       # 权限声明
│   └── icons/              # 应用图标（需自行准备）
├── index.html
├── vite.config.ts
├── tailwind.config.js
└── package.json
```

## 开发

```bash
# 安装依赖
pnpm install

# 启动开发模式（自动打开 Tauri 窗口，HMR 热更新）
pnpm dev

# 打包（本地构建：仅产出可执行文件；安装包由 CI release.yml 产出，见「打包产物」）
pnpm build
```

## 打包产物

| 平台    | 说明                                                                                                                                                                                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows | 正式发布由 GitHub Actions `release.yml` 产出：Velopack `DustNote_<版本>_x64-setup.exe`（一键安装 + 内置 Velopack 自动更新）、`DustNote_<版本>_x64-setup.msi`（可选，WiX/MSI 生成失败时缺失）、`DustNote_<版本>_x64-portable.zip` 便携版 |
| macOS   | 尽力而为构建（CI `continue-on-error`）：仅产出裸二进制 `dustnote-desktop`；`.dmg`/`.app` 打包待完善                                                                                                                                     |
| Linux   | 尽力而为构建（CI `continue-on-error`）：仅产出裸二进制 `dustnote-desktop`；`.AppImage`/`.deb` 打包待完善                                                                                                                                |

> 说明：`tauri.conf.json` 中 `bundle.active = false`，本地 `pnpm build` 仅产出
> `src-tauri/target/release/dustnote-desktop(.exe)` 可执行文件，不生成安装包；
> 安装包由 CI `release.yml` 经 Velopack（vpk pack）产出。

## 桌面端特性

- 🌿 复用 Web 端组件（基于 Vite + React 18）
- 📦 包体积 < 10MB（远小于 Electron）
- 🔒 系统级安全：Rust 内核、沙箱执行
- 🔔 系统托盘 + 关闭最小化
- ⚡ 启动项注册（autostart）
- 🌐 单机/联机双模式：单机模式数据本地存储；内置本地 server 为 v1.1 规划项

## 架构说明

桌面端通过 `frontendDist: "../dist"` 加载 Web 端构建产物。生产环境：

- Windows 由 CI 产出 Velopack 安装包；macOS / Linux 为尽力而为构建（详见「打包产物」）
- API 请求通过 `X-Client-Platform: desktop` 头识别
- masterKey 仍由用户输入，存内存
- 本地 SQLite 缓存为可选 v1.1 特性

## 注意事项

- **图标**：默认 `src-tauri/icons/` 是占位说明，**打包前需用 `@tauri-apps/cli icon` 命令生成所有规格**
- **代码签名**：v1.0 暂未集成签名（v1.1 评估）
- **本地 server**：v1 桌面端仍连线上 server；离线模式（内置 server.exe）见 v1.1
