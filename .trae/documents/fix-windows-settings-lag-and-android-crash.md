# 修复 Windows 设置卡顿 + 安卓启动闪退

## Context（背景）

v2.0.2 已发布（GitHub Actions run #53 通过，APK 已上线），但用户反馈两个问题仍存在：

1. **Windows 设置卡顿**：点进设置界面"卡一会，点一下就卡"。
   - 根因：`SettingsDialog.tsx` 的 `useEffect`（L119-141）在**每次打开设置时自动调用 `checkForUpdates()`**，触发 Rust 端 `vp_check_for_updates`（lib.rs:73-94）发起**同步阻塞网络请求到 GitHub Releases**。国内访问 GitHub 慢/不稳，前端 `withTimeout` 限 10s 仅是上限，期间设置页显示"检查更新中…"，体感卡死。dbd8a7e 加的 `withTimeout` 只是给卡死加了上限，没消除卡顿源。

2. **安卓启动闪退**：v2.0.2 构建成功但 APK 启动即崩。
   - 根因：`App.tsx` 首帧渲染 `SafeAreaProvider`（依赖 `react-native-safe-area-context` 原生模块），`mode-store.ts:99` 和 `theme.ts:89` 模块加载即调 `AsyncStorage`。若 autolinking 静默跳过原生模块（构建不报错，`PackageList.java` 为空），运行时 JS 调用未链接的原生模块即崩。
   - 现有 symlink 步骤（release.yml:233-248）理论覆盖了所有 `react-native*` / `@react-native*` 包，但 **autolinking 是否真正识别这些跨目录 symlink 无法从"构建成功"推断**——空 `PackageList.java` 也能编译通过。缺少运行时/构建时验证。

目标：彻底消除 Windows 设置页打开时的卡顿；确保安卓 APK 启动不再因原生模块缺失而闪退，并增加构建时验证防止回归。

---

## 修改一：Windows 设置卡顿（前端去除自动网络检查）

**文件**：[web/src/components/SettingsDialog.tsx](file:///e:/workspace/dustnote/web/src/components/SettingsDialog.tsx)

**改动**：修改 L119-141 的 `useEffect`，**移除自动 `checkForUpdates()` 网络调用**，仅保留 `getPendingUpdate()`（本地磁盘读取，毫秒级）。

- 打开设置时只检查"是否有已下载待应用的更新"（本地操作，快）。
- 若有 pending → 显示"更新就绪"；若无 → 状态保持 `idle`，**不自动发起网络检查**。
- 用户需主动点击"🔍 检查更新"按钮才触发网络请求（`handleCheckUpdate`，已有 10s `withTimeout`）。

理由：打开设置页是高频操作，每次都打 GitHub 网络请求既慢又无必要；检查更新应是用户主动行为。这样设置页打开即响应，不再卡顿。

保留 `handleCheckUpdate` / `handleDownloadUpdate` / `handleApplyAndRestart` 不变（用户主动点击时才走网络，10s 超时可接受）。

---

## 修改二：安卓 autolinking 加固（react-native.config.js）

**新增文件**：`mobile/react-native.config.js`

**作用**：动态读取 `mobile/package.json` 的 `dependencies`，把每个原生依赖的 `root` 显式指向工作区根 `node_modules`。这样 autolinking（`@react-native-community/cli-platform-android` 的 `native_modules.gradle`）不再依赖 `mobile/node_modules` 里的 symlink 是否被识别，而是直接从根 `node_modules` 读取原生模块代码。

逻辑要点：
- 遍历 `pkg.dependencies`，跳过 `@dustnote/shared`（workspace 包，由 Metro `extraNodeModules` 处理，无原生代码）。
- 对每个依赖，`root = path.resolve(__dirname, '..', 'node_modules', dep)`。
- 用 `fs.existsSync` 校验 `<root>/package.json` 存在才加入配置（避免 pnpm 布局差异导致路径无效）。
- autolinking 会自动跳过纯 JS 包（无 `react-native` 字段 / 无原生代码的包），所以把所有依赖都指向根 `node_modules` 是安全的。

这样即使 symlink 步骤因任何原因失效，autolinking 仍能找到 `react-native-safe-area-context`、`@react-native-async-storage/async-storage`、`react-native-screens` 等原生模块。

**保留** release.yml 现有 symlink 步骤（双保险，且 Metro 打包仍可能用到）。

---

## 修改三：安卓构建时验证 autolinking 产出（防止回归）

**文件**：[.github/workflows/release.yml](file:///e:/workspace/dustnote/.github/workflows/release.yml)（build-mobile job，`Build Android APK` 步骤之后）

**新增步骤**：`Verify autolinked native modules`，检查 RN 0.74 生成的 `PackageList.java`（路径 `mobile/android/app/build/generated/rncli/src/main/java/com/facebook/react/PackageList.java`）包含预期的原生模块包类名。

- 用 `grep` 检查关键模块是否被链接，至少包含：`SafeAreaContext`、`AsyncStorage`、`Screens`、`SVG`、`WebView`、`Keychain`、`FS`（react-native-fs）、`Biometrics`、`VectorIcons`、`SQLite`。
- 缺任一项 → `::error::` 并 `exit 1`，**让构建失败而不是产出闪退 APK**。
- 这样把"静默的运行时崩溃"转化为"响亮的构建失败"，便于定位。

预期效果：若 `react-native.config.js` 生效，`PackageList.java` 会包含全部 10 个原生模块的 `new XxxPackage()` 行，验证通过；若仍缺失，构建立即失败，不会再产出闪退 APK。

---

## 涉及文件清单

| 文件 | 操作 |
|---|---|
| `web/src/components/SettingsDialog.tsx` | 修改 useEffect（L119-141）：移除自动 checkForUpdates |
| `mobile/react-native.config.js` | 新增：动态指向根 node_modules 的 autolinking 配置 |
| `.github/workflows/release.yml` | 新增 build-mobile 的 `Verify autolinked native modules` 步骤 |

不改动 Rust 端（`desktop/src-tauri/src/lib.rs`）——前端去除自动检查已足够消除卡顿；用户主动点"检查更新"时的 10s `withTimeout` 可接受。

---

## 验证方式

### Windows 设置卡顿
1. `pnpm --filter @dustnote/web typecheck` 通过。
2. 本地 `pnpm --filter @dustnote/desktop tauri dev` 启动桌面端，打开设置页：应**立即响应**，不再显示"检查更新中…"转圈，应用更新区显示"🔍 检查更新"按钮（idle 态）。
3. 点击"🔍 检查更新"：才发起网络检查，最多 10s 出结果（正常行为）。

### 安卓 autolinking
1. `mobile/react-native.config.js` 语法校验：`node -e "require('./mobile/react-native.config.js')"` 不报错且 `dependencies` 对象包含 `react-native-safe-area-context` 等键。
2. 推送 v2.0.2 tag 触发 CI，观察 build-mobile job：
   - `Verify autolinked native modules` 步骤通过（证明 PackageList.java 含全部原生模块）。
   - APK 构建成功。
3. 下载新 APK 安装到安卓真机：启动**不再闪退**，进入模式选择页/解锁页。

### 回归
- `pnpm -r typecheck` 与 `pnpm -r lint` 通过。
- 现有单元测试 `pnpm -r test` 通过（SettingsDialog 改动仅影响 useEffect 副作用，不影响 store/导出逻辑）。

---

## 发布流程

改动完成后，用户执行已准备的 `git -C "e:\workspace\dustnote" push origin v2.0.2 --force`（或新建 v2.0.3 tag）触发 CI 重新构建发布。
