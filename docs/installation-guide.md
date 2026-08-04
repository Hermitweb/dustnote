# DustNote 安装与卸载指南

> 版本：v2.3.8 | 更新日期：2026-08-04

本文档详细说明 DustNote 在各平台的安装、卸载和自动更新流程。

---

## 目录

- [Windows 桌面端](#windows-桌面端)
- [Linux 桌面端](#linux-桌面端)
- [macOS 桌面端](#macos-桌面端)
- [Android 移动端](#android-移动端)
- [Web 端（PWA）](#web-端pwa)
- [服务端部署](#服务端部署)
- [自动更新机制](#自动更新机制)
- [数据存储位置](#数据存储位置)
- [卸载后的数据清理](#卸载后的数据清理)

---

## Windows 桌面端

### 安装

#### 方式一：安装版（推荐）

1. 从 [GitHub Releases](https://github.com/Hermitweb/dustnote/releases) 下载 `DustNote_2.3.8_x64-setup.exe`
2. 双击运行安装程序
3. 安装程序自动完成以下操作：
   - 安装到 `%LocalAppData%\DustNote\`（不写入系统目录，无需管理员权限）
   - 创建开始菜单快捷方式
   - 注册到「控制面板 → 程序和功能」（可从此卸载）
   - 注册 Velopack 自动更新服务

#### 方式二：便携版

1. 下载 `DustNote_2.3.8_x64-portable.zip`
2. 解压到任意目录
3. 双击 `dustnote-desktop.exe` 运行
4. 便携版不创建快捷方式、不注册到控制面板，适合 U 盘携带

#### 静默安装（企业批量部署）

```powershell
# 静默安装（无 UI，自动应答所有提示）
DustNote_2.3.8_x64-setup.exe --silent

# 静默安装到指定目录（覆盖默认 %LocalAppData%\DustNote）
# 注意：安装到 Program Files 等系统目录需要管理员权限
DustNote_2.3.8_x64-setup.exe --silent --installto "C:\Program Files\DustNote"

# 启用安装日志（便于问题排查）
DustNote_2.3.8_x64-setup.exe --silent --log "C:\Logs\dustnote-install.log"
```

> Velopack `Setup.exe` 支持的参数：
> - `--silent` / `-s`：隐藏所有对话框，自动应答
> - `--installto <DIR>` / `-t`：自定义安装目录
> - `--log <FILE>` / `-l`：输出安装日志
> - `--verbose` / `-v`：控制台打印调试信息

### 卸载

#### 方式一：控制面板

1. 打开「设置 → 应用 → 已安装的应用」
2. 搜索 DustNote
3. 点击「卸载」

#### 方式二：开始菜单

1. 打开开始菜单，找到 DustNote
2. 右键 → 卸载

#### 方式三：静默卸载

```powershell
# 通过 Velopack 静默卸载（移除快捷方式、文件、注册表项）
"%LocalAppData%\DustNote\current\Update.exe" uninstall --silent

# 启用卸载日志（便于审计与问题排查）
"%LocalAppData%\DustNote\current\Update.exe" --silent --log "C:\Logs\dustnote-uninstall.log" uninstall
```

### 卸载后清理

Velopack `Update.exe uninstall` 会删除（"Remove all app shortcuts, files, and registry entries"）：
- ✅ 程序文件（`%LocalAppData%\DustNote\`）
- ✅ 桌面与开始菜单快捷方式
- ✅ 注册表卸载条目（HKCU「应用和功能」）
- ✅ 自动更新服务（Update.exe 自身）

需要手动清理（按需）：
- 用户数据：`%AppData%\DustNote\`（IndexedDB、本地密钥）
- 系统托盘设置：Windows 通知中心缓存

---

## Linux 桌面端

### 安装

#### 方式一：AppImage（推荐）

1. 下载 `DustNote.AppImage`
2. 添加执行权限：
   ```bash
   chmod +x DustNote.AppImage
   ```
3. 运行：
   ```bash
   ./DustNote.AppImage
   ```

#### 系统菜单集成

将 AppImage 集成到系统应用菜单：

```bash
# 1. 移动到固定位置
sudo mv DustNote.AppImage /opt/dustnote/dustnote-desktop

# 2. 安装图标
sudo cp dustnote.png /usr/share/icons/hicolor/256x256/apps/

# 3. 安装 .desktop 文件
sudo cp dustnote.desktop /usr/share/applications/

# 4. 更新桌面数据库
sudo update-desktop-database
```

安装后可在系统应用菜单中找到 DustNote。

#### 方式二：AppImageLauncher（自动集成）

安装 [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) 后，双击 AppImage 即可自动集成到系统菜单。

### 卸载

#### AppImage 卸载

```bash
# 删除程序
sudo rm /opt/dustnote/dustnote-desktop
sudo rmdir /opt/dustnote

# 删除桌面文件和图标
sudo rm /usr/share/applications/dustnote.desktop
sudo rm /usr/share/icons/hicolor/256x256/apps/dustnote.png

# 更新数据库
sudo update-desktop-database
sudo gtk-update-icon-cache /usr/share/icons/hicolor/
```

#### 清理用户数据

```bash
rm -rf ~/.config/dustnote/
rm -rf ~/.local/share/dustnote/
```

---

## macOS 桌面端

### 安装

> ⚠️ macOS 构建受限于 CI 硬件，可能不稳定。如遇问题请使用 Web 端。

1. 下载 macOS 版本的 Velopack 包
2. 解压后将 `DustNote.app` 拖入 `/Applications/` 目录
3. 首次启动时右键 → 打开（绕过 Gatekeeper，因未签名）

> ⚠️ 当前 macOS 版本未经过 Apple 签名和公证。未来版本将加入签名支持。

### 卸载

1. 将 `/Applications/DustNote.app` 拖入废纸篓
2. 清空废纸篓
3. 清理用户数据（按需）：
   ```bash
   rm -rf ~/Library/Application\ Support/DustNote/
   rm -rf ~/Library/Caches/app.dustnote.desktop/
   rm -rf ~/Library/Preferences/app.dustnote.desktop.plist
   ```

---

## Android 移动端

### 安装

#### 方式一：直接安装 APK

1. 下载 `DustNote_2.3.8_android.apk`
2. 在手机上打开 APK 文件
3. 允许「安装未知来源应用」（首次需要）
4. 按提示完成安装

#### 需要的权限

| 权限 | 用途 | 何时申请 |
|------|------|---------|
| INTERNET | 联机模式同步数据 | 安装时声明 |
| ACCESS_NETWORK_STATE | 检测网络状态 | 安装时声明 |
| USE_BIOMETRIC | 生物识别解锁 | 首次使用时 |
| READ_EXTERNAL_STORAGE | 导入文件（Android 12 以下） | 首次导入时 |

### 卸载

1. 长按应用图标 → 卸载
2. 或：设置 → 应用 → DustNote → 卸载

卸载后系统自动清除：
- ✅ 应用沙盒内所有数据
- ✅ 应用缓存
- ✅ 应用权限

> `android:allowBackup="false"` 确保卸载后不残留备份数据。

---

## Web 端（PWA）

### 安装（添加到桌面）

DustNote Web 端支持 PWA 安装，安装后可作为独立应用使用。

#### Chrome / Edge

1. 访问 DustNote Web 地址
2. 点击地址栏右侧的安装图标 ⊕
3. 或：设置 → 安装此应用
4. 或：在 DustNote「设置 → 关于」中点击「安装为桌面应用」按钮

#### 安装后效果

- 桌面/开始菜单出现 DustNote 图标
- 独立窗口运行（无浏览器地址栏）
- 支持离线使用（Service Worker 缓存静态资源）
- 启动速度更快

### 卸载

1. 在系统应用列表中找到 DustNote
2. 右键 → 卸载
3. 或：Chrome → `chrome://apps` → 右键 DustNote → 移除

卸载后清理缓存：
```
Chrome → 设置 → 隐私和安全 → 清除浏览数据 → 缓存的图片和文件
```

---

## 服务端部署

详见 [DEPLOY.md](../DEPLOY.md) 和 [docs/self-hosting.md](self-hosting.md)。

快速部署：
```bash
docker-compose up -d
```

服务端默认运行在 `http://localhost:3210`。

---

## 自动更新机制

### 桌面端（Windows / Linux / macOS）

DustNote 桌面端使用 [Velopack](https://velopack.io/) 实现自动更新：

1. **检查更新**：设置 → 检查更新（或菜单栏 → 帮助 → 检查更新）
2. **下载更新**：后台下载差量包（Delta update，仅下载变化部分）
3. **应用更新**：下载完成后重启应用即可应用更新
4. **回滚**：Velopack 自动保留上一版本，如更新失败可回滚

更新源：GitHub Releases（`https://github.com/Hermitweb/dustnote`）

### Web 端

Service Worker 自动管理缓存更新：
1. 发布新版本后，SW_VERSION 变更触发缓存更新
2. 用户下次访问时自动加载新版本
3. 前端检测到 SW 更新后提示用户刷新

### Android

Android 端通过设置 → 检查更新功能检查 GitHub Releases 上的新版本 APK。

---

## 数据存储位置

| 平台 | 单机模式数据 | 联机模式缓存 | 配置/偏好 |
|------|------------|------------|----------|
| Windows | `%AppData%\DustNote\` (IndexedDB) | 同左 | 同左 |
| Linux | `~/.config/dustnote/` | 同左 | 同左 |
| macOS | `~/Library/Application Support/DustNote/` | 同左 | 同左 |
| Android | 应用沙盒 (AsyncStorage) | 同左 | 同左 |
| Web | IndexedDB | IndexedDB | localStorage |

### 加密密钥

- **主密码**：不存储明文，仅存 Argon2id 校验值
- **masterKey**：随机生成，双重包装（password + recovery code）
- **单机模式**：所有密钥和数据存储在本地，不上传服务器
- **联机模式**：密钥不出客户端，服务器仅存储密文

---

## 卸载后的数据清理

### 完全清除数据

如需在卸载后完全清除所有残留数据：

#### Windows
```powershell
Remove-Item -Recurse -Force "$env:APPDATA\DustNote"
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\DustNote"
```

#### Linux
```bash
rm -rf ~/.config/dustnote/
rm -rf ~/.local/share/dustnote/
```

#### macOS
```bash
rm -rf ~/Library/Application\ Support/DustNote/
rm -rf ~/Library/Caches/app.dustnote.desktop/
```

#### Android
卸载即自动清除所有数据（`allowBackup=false`）。

#### Web
清除浏览器中 DustNote 站点的所有数据（IndexedDB、localStorage、Cache Storage）。
