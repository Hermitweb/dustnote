# 集成 Velopack：替代 NSIS 打包器 + 桌面端自动更新

## Context（背景）

DustNote 桌面端当前使用 Tauri 2 的 NSIS bundler 生成 Windows 安装包，但**缺少自动更新能力**——用户必须手动下载新版安装包。引入 [Velopack](https://github.com/velopack/velopack)（Rust 编写的跨平台安装/自动更新框架）可以：

1. **替代 NSIS**：用 `vpk pack` 生成安装器 + 全量包 + **增量 delta 包**（仅下载变化字节，体积减少 70-90%）
2. **自动更新**：`UpdateManager` 检查 GitHub Releases → 下载 delta → 应用并重启（~2 秒，无 UAC 弹窗）
3. **保留 Tauri**：Tauri 仍负责窗口/托盘/快捷键/系统 API，仅把"打包+更新"职责交给 Velopack

更新源使用项目已有的 GitHub Releases（`Hermitweb/dustnote`），无需自建服务器。

> **注意**：现有服务端 `/update-manifest` 协议版本检查（`web/src/lib/use-update-check.ts`）**保留不动**——它管"服务端协议是否兼容"，与 Velopack 管的"桌面二进制是否有新版"职责正交。

---

## 实施步骤

### 第 1 步：Rust 后端 — 添加 Velopack 依赖与生命周期钩子

**文件：`desktop/src-tauri/Cargo.toml`**

- `rust-version` 从 `1.70` 提升到 `1.75`（Velopack 最低要求）
- 新增 velopack 依赖，用 `cfg` gate 排除 mobile target：
  ```toml
  [target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
  velopack = "1.2"
  ```

**文件：`desktop/src-tauri/src/main.rs`**

- 在 `main()` 第一行调用 `VelopackApp::build().run()`（Velopack 要求必须最先执行，处理 install/update/uninstall 钩子时会 fast-exit）：

  ```rust
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  use velopack::VelopackApp;

  fn main() {
      #[cfg(not(any(target_os = "android", target_os = "ios")))]
      VelopackApp::build().run();
      dustnote_desktop_lib::run();
  }
  ```

### 第 2 步：Rust 后端 — 新增更新相关 Tauri 命令

**文件：`desktop/src-tauri/src/lib.rs`**

遵循现有 `#[tauri::command]` + `invoke_handler` 模式（参考 `greet`/`show_main_window`），新增 5 个命令：

| 命令                    | 作用                                                   |
| ----------------------- | ------------------------------------------------------ |
| `vp_check_for_updates`  | 检查 GitHub Releases 是否有新版（不下载）              |
| `vp_download_updates`   | 下载更新，进度通过 event `vp://download-progress` 推送 |
| `vp_apply_and_restart`  | 应用已下载的更新并重启                                 |
| `vp_get_pending_update` | 查询是否有已下载待应用的更新                           |
| `vp_current_version`    | 返回当前应用版本                                       |

关键设计：

- 使用 `velopack::sources::GithubSource::new("https://github.com/Hermitweb/dustnote", None, false)` 作为更新源
- 所有命令返回 `Result<T, UpdaterError>`，`UpdaterError` 含 `kind`（`NotInstalled`/`Network`/`Unknown`）+ `message`
- `NotInstalled` 是 dev 期常态（`tauri dev` 时无 Velopack 定位文件），前端会吞掉此错误
- 用 `#[cfg(not(any(target_os = "android", target_os = "ios")))]` gate 所有 velopack 代码
- 在 `invoke_handler!` 宏中注册全部新命令

### 第 3 步：Tauri 配置 — 禁用 NSIS bundler

**文件：`desktop/src-tauri/tauri.conf.json`**

- `bundle.active` 改为 `false`
- `bundle.targets` 改为 `[]`（双保险）
- 保留 `icon` 配置（`vpk pack` 会用到图标资源）

### 第 4 步：前端 — 新建更新桥接模块

**新建文件：`desktop/src/lib/updater.ts`**

完全对齐现有 `desktop/src/lib/autostart.ts` 的桥接模式：

- `registerUpdaterApi()`：在 Tauri 环境下将 Rust 命令包装成 `UpdaterApi`，挂到 `window.__DUSTNOTE_UPDATER__`
- `getUpdaterApi()`：供 SettingsDialog 读取（web 端返回 `null`）
- `useUpdater()` hook：管理 `idle → checking → available → downloading → ready` 状态机，启动时静默检查一次

导出的 `UpdaterApi` 接口：

```typescript
interface UpdaterApi {
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadUpdates: () => Promise<boolean>;
  applyAndRestart: () => Promise<void>;
  getPendingUpdate: () => Promise<string | null>;
  getCurrentVersion: () => Promise<string>;
  onDownloadProgress: (cb: (pct: number) => void) => Promise<UnlistenFn>;
}
```

### 第 5 步：前端 — 注册更新 API

**文件：`desktop/src/App.tsx`**

- 在 `useEffect` 中 `registerAutostartApi()` 旁新增 `registerUpdaterApi()` 调用

### 第 6 步：前端 — SettingsDialog 增加更新区块

**文件：`web/src/components/SettingsDialog.tsx`**

在现有"桌面端"区块（autostart 开关）下方新增"应用更新"区块，沿用既有 Tailwind class 风格：

- 显示当前版本（`__APP_VERSION__`）
- 状态映射：
  - `checking` → 显示"检查中…" spinner
  - `available` + `targetVersion` → 显示"发现新版本 vX.X.X" + [下载] 按钮
  - `downloading` → 显示进度条（0-100%）
  - `ready` → 显示"更新已就绪" + [立即重启] 按钮
  - `uptodate` → 显示"已是最新版本"
  - `error` → 显示错误信息 + [重试] 按钮
- [手动检查更新] 按钮始终可见

### 第 7 步：CI 工作流 — 改用 vpk 打包

**文件：`.github/workflows/release.yml`** 的 `build-desktop` job：

1. **新增 .NET SDK 安装步骤**（`vpk` 依赖 .NET 8）：

   ```yaml
   - uses: actions/setup-dotnet@v4
     with:
       dotnet-version: '8.0.x'
   - run: dotnet tool install -g vpk
   ```

2. **替换构建命令**（原 `pnpm tauri build` → 分两步）：

   ```yaml
   - name: Build Tauri binary (no bundle)
     working-directory: desktop
     run: pnpm tauri build --no-bundle
   # 产物：desktop/src-tauri/target/release/DustNote.exe
   ```

3. **新增 vpk 打包步骤**：

   ```yaml
   - name: Pack with Velopack
     working-directory: desktop/src-tauri
     run: vpk pack --packId DustNote --packVersion ${{ env.VERSION }} --packDir target/release --mainExe DustNote.exe --channel win
   # 产物：target/release/(Releases/ + Setup.exe + *.nupkg + *.delta)
   ```

4. **上传产物**改为 Velopack 输出目录：

   ```yaml
   - uses: actions/upload-artifact@v4
     with:
       name: desktop-velopack
       path: |
         desktop/src-tauri/target/release/Setup.exe
         desktop/src-tauri/target/release/Releases/
   ```

5. **发布到 GitHub Releases**：`create-release` job 中的 assets glob 增加 `Setup.exe` 和 `Releases/` 内容（Velopack 的更新索引 `releases.win.json` + delta 包需作为 release assets 供 UpdateManager 读取）

### 第 8 步：本地开发验证

- `pnpm --filter @dustnote/desktop dev` 正常启动（Velopack 在 dev 期不报错）
- 设置对话框显示更新区块，dev 期因 `NotInstalled` 显示 idle（无报错）
- `cargo check` 通过（velopack crate 编译成功）

---

## 关键文件清单

| 文件                                    | 改动类型                                                |
| --------------------------------------- | ------------------------------------------------------- |
| `desktop/src-tauri/Cargo.toml`          | 修改：bump rust-version + 加 velopack 依赖              |
| `desktop/src-tauri/src/main.rs`         | 修改：加 VelopackApp::build().run()                     |
| `desktop/src-tauri/src/lib.rs`          | 修改：加 5 个 vp\_\* Tauri 命令 + 注册到 invoke_handler |
| `desktop/src-tauri/tauri.conf.json`     | 修改：bundle.active = false                             |
| `desktop/src/lib/updater.ts`            | **新建**：更新桥接模块 + useUpdater hook                |
| `desktop/src/App.tsx`                   | 修改：调用 registerUpdaterApi()                         |
| `web/src/components/SettingsDialog.tsx` | 修改：新增应用更新区块                                  |
| `.github/workflows/release.yml`         | 修改：build-desktop job 改用 vpk pack                   |

---

## 验证方式

1. **本地编译**：`cd desktop/src-tauri && cargo check` 确认 velopack 依赖编译通过
2. **本地运行**：`pnpm --filter @dustnote/desktop dev` 确认 Tauri 正常启动，设置对话框更新区块显示 idle（dev 期无 NotInstalled 报错）
3. **类型检查**：`pnpm --filter @dustnote/desktop typecheck` 通过
4. **CI 验证**：推送后 release.yml 的 build-desktop job 成功产出 `Setup.exe` + `Releases/` 目录
5. **端到端更新**（需发布两个版本）：v0.1.0 安装后发布 v0.1.1，应用内检查更新 → 下载 → 重启 → 版本号更新为 0.1.1
