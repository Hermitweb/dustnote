# Tauri 桌面端图标

打包前需准备以下图标规格：

| 文件 | 尺寸 | 用途 |
|------|------|------|
| `32x32.png` | 32×32 | Windows 任务栏 |
| `128x128.png` | 128×128 | macOS App Store |
| `128x128@2x.png` | 256×256 | 高 DPI |
| `icon.icns` | 多尺寸 | macOS 完整图标集 |
| `icon.ico` | 多尺寸 | Windows 完整图标集 |
| `tray-icon.png` | 32×32 | 系统托盘 |

## 快速生成

```bash
# 用 @tauri-apps/cli 从单个 1024x1024 PNG 生成所有规格
npx @tauri-apps/cli icon path/to/source-1024.png
```

## 占位提示

当前此目录为空。打包前请先生成图标（推荐用 [Figma](https://figma.com) 设计薄荷绿主题的 1024×1024 PNG，再运行上述命令）。
