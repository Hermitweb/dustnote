# Tauri 桌面端图标

本目录包含打包所需的全部图标资源。

| 文件             | 尺寸    | 用途               |
| ---------------- | ------- | ------------------ |
| `32x32.png`      | 32x32   | Windows 任务栏     |
| `64x64.png`      | 64x64   | 通用                |
| `128x128.png`    | 128x128 | macOS App Store    |
| `128x128@2x.png` | 256x256 | 高 DPI             |
| `icon.icns`      | 多尺寸  | macOS 完整图标集   |
| `icon.ico`       | 多尺寸  | Windows 完整图标集 |
| `icon.png`       | 1024x1024 | 源图标           |
| `tray-icon.png`  | 32x32   | 系统托盘           |
| `Square*Logo.png`| 多尺寸  | Windows Store      |
| `StoreLogo.png`  | 50x50   | Windows Store      |
| `android/`       | 多尺寸  | Android 启动器图标 |
| `ios/`           | 多尺寸  | iOS App Icon       |

## 快速生成

```bash
# 用 @tauri-apps/cli 从单个 1024x1024 PNG 生成所有规格
npx @tauri-apps/cli icon path/to/source-1024.png
```