# 跨平台 Bug 修复计划（安卓 / 小程序 / Windows）

## Context

用户反馈 DustNote 三端共 10+ 个问题。经调查，多数问题有共同根因：

- **安卓**：部分屏幕未迁移到 `createRepository` 工厂模式，单机模式(standalone)下直接调用联机 API 必然失败；`store.ts` 的 `updateNote` 乐观更新漏写 `isPinned/isFavorite` 字段。
- **小程序**：模式选择页白屏，CSS 样式齐全（非根因），疑为运行时模块加载错误或 dist 不同步。
- **Windows**：更新检查无超时保护导致卡死；部分弹窗仍用原生 `confirm()/alert()`。

目标：逐一修复，确保三端功能正常。

---

## 一、安卓版修复（mobile/）

### 1. 迁移 FoldersScreen / TrashScreen / TagsScreen 到 createRepository

**根因**：这三个屏幕直接用 `api.get/post/delete`（联机 API），单机模式无服务器必崩。`NotesListScreen`/`NoteEditScreen`/`SettingsScreen` 已正确迁移。

**修改文件与要点**（参考 `NotesListScreen.tsx:35,90-93` 的迁移模式）：

- `mobile/src/screens/FoldersScreen.tsx`
  - 替换 `import { api } from '../api'` → 引入 `createRepository` + `useModeStore`
  - `load()`：`api.get('/folders')` → `repo.loadAll()` 取 `snapshot.folders`
  - `handleCreate()`：`api.post('/folders',{name})` → `repo.createFolder({name})`
  - `handleDelete()`：`api.delete('/folders/${id}')` → `repo.deleteFolder(id)`

- `mobile/src/screens/TrashScreen.tsx`
  - `load()`：`api.get('/notes?includeDeleted=1')` → `repo.loadAll()` 过滤 `deletedAt`
  - `handleRestore()`：`api.patch(...)` → `repo.restoreNote(id)`
  - `handlePermanentDelete()`：`api.delete(...)` → `repo.permanentDeleteNote(id)`
  - `handleEmptyTrash()`：**`Promise.all` → `for...of` 顺序删除**（硬约束）或直接调用 `repo.emptyTrash()`

- `mobile/src/screens/TagsScreen.tsx`
  - `load()`：`api.get('/tags')` → `repo.loadAll()` 取 `snapshot.tags`
  - `handleDelete()`：`api.delete('/tags/${id}')` → `repo.deleteTag(id)`
  - 创建标签：补 `repo.createTag(name)`（当前可能缺失创建功能）

### 2. 修复 NotesListScreen 标题修改后不刷新

**根因**：从 NoteEditScreen 返回列表时，`useEffect` 依赖未变化，不重新 load。

**修改**：`mobile/src/screens/NotesListScreen.tsx`

- 引入 `useFocusEffect` from `@react-navigation/native`
- 用 `useFocusEffect(useCallback(() => { void load(); }, [load]))` 替代/补充现有 `useEffect`，屏幕聚焦时重新加载

### 3. 修复 emptyTrash 顺序删除（硬约束）

**修改文件**：

- `mobile/src/lib/remote-repo.ts`（`emptyTrash` 方法）：`Promise.all(map(...))` → `for...of` 顺序删除
- `web/src/lib/remote-repo.ts`（`emptyTrash` 方法）：同上修复

### 4. 安卓更新检查

**根因**：mobile 端未接入更新检查功能。

**修改**：

- 新建 `mobile/src/lib/use-update-check.ts`，参考 `web/src/lib/use-update-check.ts`，复用 `shared/src/update-check.ts` 的 `checkForUpdate`，platform 设为 `'android'`，超时 10s
- `mobile/src/screens/SettingsScreen.tsx`：在关于区域添加更新检查入口

### 5. 主题缺失

**调查**：`theme.ts` 的 `useColors`/`useThemeStore` 逻辑正常，`SettingsScreen` 已调用 `setMode`。需在实现时确认：

- 主题切换后是否立即生效（`useColors` 是否响应 `useThemeStore` 变化）
- 单机模式下主题偏好是否持久化（`AsyncStorage`）

---

## 二、微信小程序修复（miniprogram/）

### 6. 模式选择页白屏诊断与修复

**已排除**：app.scss 样式齐全（`.hero` L254、`.mint-card` L190 等），CSS 非根因。

**诊断步骤**：

1. 重新构建：`cd miniprogram && npm run build:weapp`
2. 检查 `dist/pages/mode-select/index.js` 是否存在且非空
3. 检查 `dist/app.js` 是否有运行时错误
4. 排查 `mode-select/index.tsx` 的导入链：`ApiClient`(L18)、`hasLocalAuthSync`(L17)、`useModeStore`(L16) 是否在加载时抛错
5. 检查 `miniprogram/src/lib/mode-store.ts` 和 `local-auth-storage.ts` 的初始化是否阻塞渲染

**潜在修复**：

- 若 `mode-store.ts` 在模块加载时同步调用 `Taro.getStorageSync` 抛错，加 try-catch
- 若导入的 shared 模块在加载时报错（如引用了浏览器专属 API），需条件导入或 polyfill
- 确认 dist 产物与源码同步（之前的 app.tsx/app.config.ts 修改可能未重新编译）

---

## 三、Windows 版修复（desktop/ + web/）

### 7. 修复 pin/favorite 按钮无反应（根因已定位）

**根因**：`web/src/lib/store.ts` 的 `updateNote` 乐观更新只写了 `ciphertext`，漏写 `isPinned`/`isFavorite`，导致点击后 UI 不变（按钮样式依赖这两个字段）。

**修改**：`web/src/lib/store.ts`

- L1069（单机模式乐观更新）：
  ```ts
  newNotes.set(id, {
    ...note,
    ciphertext: cipherJson,
    version,
    isPinned: patch.isPinned ?? note.isPinned,
    isFavorite: patch.isFavorite ?? note.isFavorite,
  });
  ```
- L1088（联机模式乐观更新）：
  ```ts
  newNotes.set(id, {
    ...note,
    ciphertext: cipherJson,
    isPinned: patch.isPinned ?? note.isPinned,
    isFavorite: patch.isFavorite ?? note.isFavorite,
  });
  ```
- 参考 `moveNote`(L1128) 正确写入了 `folderId` 的模式

### 8. 修复 lock 按钮无反应

**现状**：`web/src/App.tsx:311-318` lock 按钮 `onClick={lock}` 实现正常，`store.ts` 的 `lock()` 设置 `authState='needs_unlock'`。

**调查**：实现时确认 `lock()` 调用后 App.tsx 是否正确响应 `authState` 变化并跳转到锁定/解锁页。若 Tauri 桌面端 lock 后无路由变化，需修复导航逻辑。

### 9. 修复更新检查超时卡死

**根因**：`desktop/src/lib/updater.ts:101-120` `check()` 无超时保护，启动时 `useEffect`(L161) 自动调用，Tauri IPC 挂起时卡死。

**修改**：`desktop/src/lib/updater.ts` `check()` 函数

- 用 `Promise.race` 添加 10s 超时：
  ```ts
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('检查更新超时')), 10_000)
  );
  const r = await Promise.race([api.checkForUpdates(), timeoutPromise]);
  ```
- 超时后 `setState('error')` + `setError('检查更新超时，请稍后重试')`

### 10. 弹窗样式重构（替换原生 confirm/alert）

**确认的原生弹窗**：

- `web/src/components/NoteHistoryDialog.tsx:115`：`confirm(t('history.restore_confirm'))` → 用 ConfirmDialog 替换
- `web/src/components/SharesManager.tsx:128`：`alert(t('shares.revoke_fail',...))` → 用自定义提示/Toast 替换

**修改要点**：

- NoteHistoryDialog：添加 `showRestoreConfirm` state，用 `ConfirmDialog`（参考 `Editor.tsx:454-466` 模式）
- SharesManager：`alert` 替换为内联错误提示或 toast 组件
- 确认"关于信息弹窗"已用 `AboutDialog` 组件（已存在），若未接入则接入

### 11. i18n 中文翻译核查

**调查结论**：`editor.pin`/`editor.favorite` 在 zh-CN 中已存在（误报）。`app_bar.lock` 也已存在。

**仍需确认**：实现时通读 `web/src/lib/i18n.ts` 的 zh-CN 部分，确认顶部导航栏所有按钮 title 都有中文翻译。若用户说的"编辑选项列表还是英文"是指某处遗漏的 key，补上。

---

## 四、验证方案

### 安卓

1. `cd shared && npm run build`（确保 shared/dist 最新）
2. 构建 APK：`cd mobile/android && gradlew assembleRelease`
3. 安装到设备，单机模式下测试：
   - 创建文件夹 ✓
   - 创建笔记 → 删除 → 回收站可见 ✓
   - 添加/删除标签 ✓
   - 编辑标题 → 返回列表自动刷新 ✓
   - 检查更新 ✓
4. logcat 监听确认无报错

### 小程序

1. `cd miniprogram && npm run build:weapp`
2. 微信开发者工具打开，确认模式选择页正常渲染
3. Console 无红色错误

### Windows

1. `cd desktop && npm run tauri dev`
2. 测试 pin/favorite 按钮点击后样式立即变化 ✓
3. 测试 lock 按钮点击后跳转锁定状态 ✓
4. 设置中检查更新，超时后显示错误提示而非卡死 ✓
5. 笔记历史恢复、分享撤销显示自定义弹窗 ✓

---

## 实现顺序

1. **P0**：store.ts pin/fav 修复（2行，影响 Web+Desktop）
2. **P0**：Mobile 三屏幕迁移 createRepository（FoldersScreen/TrashScreen/TagsScreen）
3. **P0**：emptyTrash 顺序删除（硬约束）
4. **P1**：NotesListScreen useFocusEffect 刷新
5. **P1**：Desktop updater 超时保护
6. **P1**：NoteHistoryDialog + SharesManager 替换原生弹窗
7. **P1**：Mobile 更新检查功能
8. **P2**：小程序白屏诊断（需重新构建+运行时调试）
9. **P2**：lock 按钮、主题、i18n 核查
