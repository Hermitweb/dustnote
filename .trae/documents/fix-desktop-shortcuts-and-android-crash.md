# 修复 Windows 桌面端网页元素感 + 安卓闪退适配

## Context

用户反馈两个问题：

1. **Windows 桌面端**：设置不卡了，但软件内存在网页元素（右键菜单是浏览器默认的、图片可拖拽、文本可选中），不像本地应用。需要优化快捷键支持。
2. **安卓端**：依然打开就闪退。需要适配安卓9到最新版本。

之前已修复 autolinking、图标、MainActivity.onCreate 等，但闪退仍存在。本次从**构建配置、Manifest、Kotlin Application、JS ErrorBoundary、Store init** 五层防御闪退。

版本号：**2.0.3 → 2.0.4**（patch：bug fix + 桌面体验优化）。

***

## 任务1：Windows 桌面端 — 消除网页元素感 + 快捷键

### 1.1 Tauri 原生菜单栏（Rust 端）

**文件**: [lib.rs](file:///e:/workspace/dustnote/desktop/src-tauri/src/lib.rs)

在 `run()` 的 `.setup()` 中构建菜单，通过 `app.set_menu(menu)` 挂载：

| 菜单     | 子项                | 快捷键    | menu id                  | 行为                        |
| ------ | ----------------- | ------ | ------------------------ | ------------------------- |
| 文件(F)  | 新建笔记              | Ctrl+N | `file_new_note`          | emit `menu://action` 给前端  |
| <br /> | 退出                | Ctrl+Q | `file_quit`              | `app.exit(0)`             |
| 编辑(E)  | 撤销/重做/剪切/复制/粘贴/全选 | —      | —                        | `PredefinedMenuItem` 自动处理 |
| 视图(V)  | 放大                | Ctrl+= | `view_zoom_in`           | `window.set_zoom_level()` |
| <br /> | 缩小                | Ctrl+- | `view_zoom_out`          | 同上                        |
| <br /> | 重置缩放              | Ctrl+0 | `view_zoom_reset`        | 同上                        |
| <br /> | 全屏                | F11    | `view_toggle_fullscreen` | `window.set_fullscreen()` |
| <br /> | 侧边栏               | Ctrl+B | `view_toggle_sidebar`    | emit 给前端                  |
| 帮助(H)  | 关于                | —      | `help_about`             | `MessageDialog` 弹窗        |
| <br /> | 检查更新              | —      | `help_check_update`      | emit 给前端                  |

关键实现：

* 使用 `tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu}`

* `file_new_note` / `view_toggle_sidebar` / `help_check_update` → `app.emit("menu://action", id)`

* 预定义菜单项（剪切/复制等）由 Tauri 自动处理，不需要 handler

### 1.2 应用内快捷键 hook（前端）

**新增文件**: `web/src/lib/platform.ts`

```typescript
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
export function isProduction(): boolean {
  return import.meta.env.PROD;
}
```

**新增文件**: `web/src/lib/use-keyboard-shortcuts.ts`

集中注册快捷键，在 App 顶层挂载（仅 `authState === 'unlocked'` 时生效）：

| 快捷键    | 动作    | 桌面独占 | 实现方式                                  |
| ------ | ----- | ---- | ------------------------------------- |
| Ctrl+N | 新建笔记  | 是    | `useStore.getState().createNote()`    |
| Ctrl+S | 立即保存  | 是    | dispatch `editor:save-now` 自定义事件      |
| Ctrl+F | 聚焦搜索  | 否    | `useStore.getState().focusSearch()`   |
| Ctrl+B | 切换侧边栏 | 否    | `useStore.getState().toggleSidebar()` |
| Ctrl+, | 打开设置  | 否    | dispatch `app:open-settings` 事件       |
| Ctrl+L | 锁定    | 否    | `useStore.getState().lock()`          |

同时监听 Tauri 菜单事件 `menu://action`，复用同一组 action。

输入框内不触发（除非 `allowInInput`），`e.preventDefault()` + `e.stopPropagation()`。

### 1.3 Store 新增字段

**文件**: [store.ts](file:///e:/workspace/dustnote/web/src/lib/store.ts)

新增 UI 临时状态（不持久化）：

* `sidebarHidden: boolean` + `toggleSidebar()`

* `searchFocusToken: number` + `focusSearch()`

### 1.4 前端组件修改

**文件**: [App.tsx](file:///e:/workspace/dustnote/web/src/App.tsx)

* 挂载 `useKeyboardShortcuts` hook

* 监听 `app:open-settings` 事件打开设置

* 根据 `sidebarHidden` 控制 Sidebar 渲染

**文件**: [Sidebar.tsx](file:///e:/workspace/dustnote/web/src/components/Sidebar.tsx)

* 监听 `searchFocusToken` 变化时 `inputRef.current?.focus()`

**文件**: [Editor.tsx](file:///e:/workspace/dustnote/web/src/components/Editor.tsx)

* 监听 `editor:save-now` 事件，绕过防抖立即保存

### 1.5 禁用网页默认行为 + 滚动条样式

**文件**: [main.tsx](file:///e:/workspace/dustnote/web/src/main.tsx)

* 设置 `document.documentElement.dataset.platform` = `desktop`/`web`

* 桌面+生产环境：`contextmenu` 事件 `preventDefault`

* 桌面端：拦截 Ctrl+O/Ctrl+P 的浏览器默认行为

**文件**: [index.css](file:///e:/workspace/dustnote/web/src/index.css)

`html[data-platform='desktop']` 下：

* `body { user-select: none; }`，输入框/prose 例外

* `img, a, button { user-drag: none; }`

* 自定义 `::-webkit-scrollbar` 样式（窄边圆角灰色 thumb）

### 1.6 权限配置

**文件**: [default.json](file:///e:/workspace/dustnote/desktop/src-tauri/capabilities/default.json)

已有 `core:menu:default`，追加：

* `core:window:allow-set-fullscreen`

* `core:window:allow-is-fullscreen`

* `core:webview:allow-set-webview-zoom`

***

## 任务2：安卓闪退修复 — 适配安卓9到最新

### 2.1 启用 Jetifier

**文件**: [gradle.properties](file:///e:/workspace/dustnote/mobile/android/gradle.properties)

```properties
android.enableJetifier=true  # false → true
```

自动转换旧 support library 依赖为 AndroidX，消除运行时 `NoClassDefFoundError`。构建时间 +30-60s，但不影响运行时性能。

### 2.2 AndroidManifest 优化

**文件**: [AndroidManifest.xml](file:///e:/workspace/dustnote/mobile/android/app/src/main/AndroidManifest.xml)

`<application>` 标签新增：

* `android:largeHeap="true"` — 避免大笔记加密时 OOM

* `android:hardwareAccelerated="true"` — 明确启用硬件加速

* `android:extractNativeLibs="true"` — 避免某些 ROM 安装时解压失败

### 2.3 MainApplication.kt 加固

**文件**: [MainApplication.kt](file:///e:/workspace/dustnote/mobile/android/app/src/main/java/com/dustnote/MainApplication.kt)

`onCreate()` 包裹 try/catch，SoLoader 初始化失败时记录日志但不崩溃。

### 2.4 ErrorBoundary

**新增文件**: `mobile/src/components/ErrorBoundary.tsx`

Class component 实现 `getDerivedStateFromError` + `componentDidCatch`，捕获 JS 错误显示友好界面（重新加载 / 复制日志）而非闪退。

**文件**: [App.tsx](file:///e:/workspace/dustnote/mobile/src/App.tsx)

用 `<ErrorBoundary>` 包裹整个 App。启动流程加 5s timeout 兜底：`init()` 超时后强制切到 `needs_unlock`。

### 2.5 Auth Store 错误处理加固

**文件**: [auth.ts](file:///e:/workspace/dustnote/mobile/src/state/auth.ts)

`init()` 方法加强：

* `checkStatusStandalone` 加 try/catch，失败时回退到 `uninitialized`

* `Keychain.canImplyAuthentication` 加 1.5s 超时 + 双层 try/catch

* `/auth/status` 失败时明确设置状态

**文件**: [mode-store.ts](file:///e:/workspace/dustnote/mobile/src/lib/mode-store.ts)

`hydrate()` 加外层 try/catch 双保险。

### 2.6 版本号更新

全项目 2.0.3 → 2.0.4：

* `package.json`（根/web/mobile/shared）

* `desktop/src-tauri/tauri.conf.json` + `Cargo.toml`

* `mobile/android/app/build.gradle`（versionCode 4→5）

* `mobile/src/api.ts` 中的 `APP_VERSION`

* `server/src/services/update-manifest.ts` 中的 miniprogram version

***

## 实现顺序

1. **基础设施**（并行）：platform.ts、store.ts 新增字段、ErrorBoundary.tsx、gradle.properties、AndroidManifest、版本号
2. **核心实现**：use-keyboard-shortcuts.ts、lib.rs 菜单、App.tsx 接入（web+mobile）、auth.ts 加固、MainApplication.kt
3. **细节完善**：index.css、main.tsx、Sidebar.tsx、Editor.tsx、capabilities/default.json
4. **提交推送**：commit + push + 重新打 v2.0.4 tag

## 验证方法

### 桌面端

* 启动后标题栏下方出现"文件/编辑/视图/帮助"菜单

* Ctrl+N/S/F/B/,/L 快捷键功能正常

* 生产构建右键无菜单、图片不可拖拽、文本不可选中

* 滚动条为窄边圆角样式

* web 版功能不受影响（Ctrl+N 打开新窗口等浏览器行为保留）

### 安卓端

* 构建日志包含 Jetifier 处理

* APK 启动无闪退（Android 9/12/14 测试矩阵）

* ErrorBoundary 捕获 JS 错误显示友好界面

* Keychain 超时 1.5s 后继续执行

* init() 超时 5s 后切到 needs\_unlock

