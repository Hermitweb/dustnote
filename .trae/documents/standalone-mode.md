# DustNote 单机模式（Standalone Mode）说明

> 文档版本：v2.0.0
> 适用产品：DustNote · 尘心笔记
> 目标读者：架构师 / 客户端工程师 / 安全工程师 / 用户（高级）
> 关联文档：[tech-architecture.md](./tech-architecture.md)、[security.md](./security.md)、[data-flow.md](./data-flow.md)、[update-strategy.md](./update-strategy.md)

---

## 0. 概述

DustNote v2.0.0 引入**单机/联机双模式架构**，让客户端在**完全没有服务器**的情况下也能独立运行：

- **单机模式（standalone）**：所有数据存储在本地，主密码本地校验，零服务器依赖
- **联机模式（online）**：连接 DustNote 服务器，解锁跨设备同步、在线分享、协作等高级能力

### 0.1 设计目标

1. **零门槛试用**——用户无需部署服务器即可体验完整笔记 CRUD
2. **隐私优先**——单机模式下数据永不离开设备，符合"零信任"理念
3. **平滑升级**——单机 → 联机一键迁移，不丢数据
4. **架构对齐**——单机/联机共用同一套 `DataRepository` 接口，业务代码无感知
5. **可恢复**——单机模式同样支持主密码遗忘后的恢复码机制

---

## 1. 能力矩阵（单机 vs 联机）

| 能力                 | 单机模式（standalone）                                            | 联机模式（online）                          |
| -------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| 主密码 setup/unlock   | 本地 Argon2id + 比对（无 JWT）                                    | 调 `/auth/setup`、`/auth/unlock`             |
| 笔记/文件夹/标签 CRUD | `LocalRepository`（IndexedDB / AsyncStorage / Taro.setStorage）   | `RemoteRepository`（API + 离线队列）        |
| 偏好设置             | 仅本地                                                            | API + 本地双写                              |
| 分享                 | **仅文件导出**（txt / md / html / pdf）                           | 在线分享链接 + 文件导出                     |
| 设备管理             | **不支持**（UI 隐藏）                                             | 支持（踢出、查看会话）                      |
| 跨设备同步           | **不支持**                                                        | WebSocket + 离线队列                        |
| 在线备份             | **不支持**（仅本地导出 ZIP）                                      | 支持（服务端定期备份）                      |
| 自动更新             | GitHub Release（Velopack）                                        | 同上 + `/update-manifest` 双重检查          |
| 服务端依赖           | 无                                                                | 必需                                        |
| 数据存储位置         | 设备本地                                                          | 设备本地 + 服务器                           |

> **用户决策记录**：单机版本"分享"功能限定为文件导出（txt/md/html/pdf），不提供在线分享链接。

---

## 2. 本地存储方案

各端 `LocalRepository` 实现使用不同的本地存储后端，但接口契约完全一致（由 [shared/src/repository.ts](file:///e:/workspace/dustnote/shared/src/repository.ts) 统一约束）。

| 端           | 存储后端                 | 实现文件                                                                        | 备注                                                                              |
| ------------ | ------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Web / Desktop | IndexedDB（Dexie 风格） | [web/src/lib/local-repo.ts](file:///e:/workspace/dustnote/web/src/lib/local-repo.ts)        | 桌面端复用 Web 代码，自动获得 IndexedDB；容量大（GB 级）                         |
| Mobile       | AsyncStorage             | [mobile/src/lib/local-repo.ts](file:///e:/workspace/dustnote/mobile/src/lib/local-repo.ts)  | **项目未安装 react-native-mmkv**，使用 AsyncStorage 替代；JSON 序列化存储        |
| Miniprogram  | Taro.setStorage          | [miniprogram/src/lib/local-repo.ts](file:///e:/workspace/dustnote/miniprogram/src/lib/local-repo.ts) | 单 key 10MB 上限；适合轻量试用                                                   |

### 2.1 存储结构

`LocalRepository` 在底层存储中维护以下逻辑分区：

```
local:
├── notes          # NoteRow[]：含 id/title/content(ciphertext)/tags/folderId/isPinned/isFavorite/createdAt/updatedAt/deletedAt
├── folders        # Folder[]：含 id/name/createdAt/updatedAt
├── tags           # Tag[]：含 id/name/color/createdAt
├── preferences    # Preferences：主题/字体/密度/自动锁屏等
└── meta           # schemaVersion / lastModifiedAt

auth:
├── local_auth_blob      # LocalAuthBlob：见 §4
└── local_lockout_state  # LocalLockoutState：见 §5
```

### 2.2 关键文件契约

类型定义位于 [shared/src/types.ts](file:///e:/workspace/dustnote/shared/src/types.ts)，关键类型包括：

- `AppMode`：`'standalone' | 'online'`
- `NoteRow`：单条笔记（含密文字段）
- `Folder`：文件夹
- `Tag`：标签
- `Preferences`：偏好设置
- `LocalAuthBlob`：单机鉴权载体
- `ModeState`：模式状态

### 2.3 工厂函数

各端通过 `createRepository(mode, opts)` 工厂函数注入：

| 端           | 工厂文件                                                                                |
| ------------ | --------------------------------------------------------------------------------------- |
| Web          | [web/src/lib/repository.ts](file:///e:/workspace/dustnote/web/src/lib/repository.ts)    |
| Mobile       | [mobile/src/lib/repository.ts](file:///e:/workspace/dustnote/mobile/src/lib/repository.ts) |
| Miniprogram  | [miniprogram/src/lib/repository.ts](file:///e:/workspace/dustnote/miniprogram/src/lib/repository.ts) |

```typescript
// shared/src/repository.ts（简化示意）
export interface DataRepository {
  loadAll(): Promise<{ notes: NoteRow[]; folders: Folder[]; tags: Tag[]; preferences: Preferences }>;
  createNote(input): Promise<NoteRow>;
  updateNote(id, patch): Promise<NoteRow>;
  moveNote(id, folderId): Promise<NoteRow>;
  deleteNote(id): Promise<void>;          // 软删除
  permanentDeleteNote(id): Promise<void>;
  emptyTrash(): Promise<void>;
  restoreNote(id): Promise<NoteRow>;
  createFolder(name): Promise<Folder>;
  deleteFolder(id): Promise<void>;
  createTag(name, color): Promise<Tag>;
  deleteTag(id): Promise<void>;
  getPreferences(): Promise<Preferences>;
  setPreferences(patch): Promise<Preferences>;
  exportBackup(): Promise<Blob>;
  importBackup(blob): Promise<void>;
  clearBusinessData(): Promise<void>;     // 模式切换迁移后清空
}
```

> **注意**：`DataRepository` **不含鉴权方法**（setup/unlock/lock/recover），鉴权由各端的 mode-store + auth-store 单独处理，详见 §4。

---

## 3. 模式状态管理

每端独立的 `mode-store`（Zustand）维护模式判定结果，与 `auth-store` 解耦：

| 端           | 模式状态文件                                                                              | 持久化后端                  |
| ------------ | ----------------------------------------------------------------------------------------- | --------------------------- |
| Web          | [web/src/lib/mode-store.ts](file:///e:/workspace/dustnote/web/src/lib/mode-store.ts)       | localStorage                |
| Mobile       | [mobile/src/lib/mode-store.ts](file:///e:/workspace/dustnote/mobile/src/lib/mode-store.ts) | AsyncStorage                |
| Miniprogram  | [miniprogram/src/lib/mode-store.ts](file:///e:/workspace/dustnote/miniprogram/src/lib/mode-store.ts) | Taro.setStorageSync         |

### 3.1 状态字段

```typescript
interface ModeState {
  mode: 'standalone' | 'online';
  serverUrl: string | null;       // 联机模式下的服务器地址
  initialized: boolean;            // 是否已完成首次模式选择
  chooseStandalone(): Promise<void>;
  chooseOnline(serverUrl: string): Promise<void>;
  switchMode(mode: 'standalone' | 'online', serverUrl?: string): Promise<void>;
}
```

### 3.2 首次启动流程

1. App 启动 → 读取 `mode-store.initialized`
2. 若 `initialized === false` → 显示模式选择 UI
   - Web：[web/src/components/ModeSelectDialog.tsx](file:///e:/workspace/dustnote/web/src/components/ModeSelectDialog.tsx)
   - Mobile：[mobile/src/screens/ModeSelectScreen.tsx](file:///e:/workspace/dustnote/mobile/src/screens/ModeSelectScreen.tsx)
   - Miniprogram：[miniprogram/src/pages/mode-select/index.tsx](file:///e:/workspace/dustnote/miniprogram/src/pages/mode-select/index.tsx)
3. 用户选择「单机使用」或「连接服务器」
4. 持久化 `mode` + `serverUrl`（联机模式），置 `initialized = true`
5. 进入对应模式的鉴权流程

### 3.3 模式切换

模式切换由 `switchMode(mode, serverUrl?)` 触发，但**必须先进行数据迁移**（详见 §7），避免数据丢失。SettingsDialog / SettingsScreen 提供入口，强制提示用户。

---

## 4. 单机鉴权流程

单机模式鉴权完全在客户端完成，**不调用任何服务端接口**。所有逻辑在 [shared/src/local-auth.ts](file:///e:/workspace/dustnote/shared/src/local-auth.ts) 中实现，各端通过 `local-auth-storage` 模块持久化 `LocalAuthBlob`。

### 4.1 关键设计：masterKey 双重包装

> v2.0.0 关键改进：**masterKey 随机生成，不从密码派生**。这样改密码或 recover 后无需重加密所有笔记。

```
                            ┌─────────────────────────────────┐
                            │      随机生成的 masterKey        │
                            │      （32B，AES-256-GCM 用）     │
                            └────────────┬────────────────────┘
                                         │
                ┌────────────────────────┴────────────────────────┐
                │                                                  │
       Argon2id(password, salt_pw)                    Argon2id(recoveryCode, salt_rc)
                │                                                  │
                ▼                                                  ▼
   passwordWrappedMasterKey                       recoveryWrappedMasterKey
   （AES-GCM 加密 masterKey）                     （AES-GCM 加密 masterKey）
                │                                                  │
                └────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
                    LocalAuthBlob 持久化到本地存储
                    （含 passwordHash + 双重 wrapped masterKey）
```

**双重包装的意义**：

- `passwordWrappedMasterKey`：用主密码派生的 KEK 加密 masterKey，**解锁时**用主密码解封
- `recoveryWrappedMasterKey`（即 `wrappedMasterKey`）：用恢复码派生的 KEK 加密 masterKey，**恢复时**用恢复码解封
- 改密码 = 重新派生 KEK + 重新包装 masterKey，**笔记密文不动**
- recover = 用恢复码解封 masterKey + 用新密码重新包装，**笔记密文不动**

### 4.2 LocalAuthBlob 结构

```typescript
interface LocalAuthBlob {
  passwordHash: string;            // Argon2id(password) 用于 unlock 比对
  masterSalt: string;              // 主密码派生 KEK 的盐
  clientMasterSalt: string;        // 客户端派生 KEK 的盐（与 masterSalt 区分）
  passwordWrappedMasterKey: string; // 主密码 KEK 加密的 masterKey
  wrappedMasterKey: string;        // 恢复码 KEK 加密的 masterKey（用于 recover）
  recoveryHash: string;            // Argon2id(recoveryCode) 用于 recover 校验
  recoverySalt: string;            // 恢复码派生 KEK 的盐
  kdfParams: { m: number; t: number; p: number };  // Argon2id 参数
}
```

各端持久化实现：

| 端           | 持久化文件                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| Web          | [web/src/lib/local-auth-storage.ts](file:///e:/workspace/dustnote/web/src/lib/local-auth-storage.ts)  |
| Mobile       | [mobile/src/lib/local-auth-storage.ts](file:///e:/workspace/dustnote/mobile/src/lib/local-auth-storage.ts) |
| Miniprogram  | [miniprogram/src/lib/local-auth-storage.ts](file:///e:/workspace/dustnote/miniprogram/src/lib/local-auth-storage.ts) |

### 4.3 setup（首次设置）

```
用户输入主密码 →
  1. 随机生成 32B masterKey（crypto.getRandomValues）
  2. 随机生成 12 位恢复码（diceware 风格）
  3. Argon2id(password, masterSalt) → passwordKek
  4. Argon2id(recoveryCode, recoverySalt) → recoveryKek
  5. AES-GCM(passwordKek).encrypt(masterKey) → passwordWrappedMasterKey
  6. AES-GCM(recoveryKek).encrypt(masterKey) → wrappedMasterKey
  7. Argon2id(password) → passwordHash（constantTimeEqual 用）
  8. Argon2id(recoveryCode) → recoveryHash
  9. 持久化 LocalAuthBlob 到本地存储
  10. 内存中保留 masterKey（用于业务加解密）
  11. 单次显示恢复码，强制用户抄写
```

UI 入口：

- Web：[web/src/screens/StandaloneSetupScreen.tsx](file:///e:/workspace/dustnote/web/src/screens/StandaloneSetupScreen.tsx)
- Mobile：[mobile/src/screens/StandaloneSetupScreen.tsx](file:///e:/workspace/dustnote/mobile/src/screens/StandaloneSetupScreen.tsx)
- Miniprogram：[miniprogram/src/pages/standalone-setup/index.tsx](file:///e:/workspace/dustnote/miniprogram/src/pages/standalone-setup/index.tsx)

### 4.4 unlock（日常解锁）

```
用户输入主密码 →
  1. 读取 LocalAuthBlob
  2. 检查 LocalLockoutState（见 §5），若处于锁定中 → 拒绝并提示剩余时间
  3. Argon2id(password, masterSalt) → passwordKek
  4. Argon2id(password) → passwordHash'
  5. constantTimeEqual(passwordHash', blob.passwordHash)
     - 失败 → 失败计数 +1，达到阈值则锁定
     - 成功 → 继续
  6. AES-GCM(passwordKek).decrypt(passwordWrappedMasterKey) → masterKey
  7. masterKey 写入内存（闭包/Web Worker，不入盘）
  8. 失败计数清零
```

UI 入口：

- Web：[web/src/screens/StandaloneUnlockScreen.tsx](file:///e:/workspace/dustnote/web/src/screens/StandaloneUnlockScreen.tsx)
- Mobile：[mobile/src/screens/StandaloneUnlockScreen.tsx](file:///e:/workspace/dustnote/mobile/src/screens/StandaloneUnlockScreen.tsx)
- Miniprogram：[miniprogram/src/pages/standalone-unlock/index.tsx](file:///e:/workspace/dustnote/miniprogram/src/pages/standalone-unlock/index.tsx)

### 4.5 recover（恢复码重置）

> **关键设计**：recover 后 masterKey **保留**（不重新生成），所以历史笔记的密文无需重加密。

```
用户输入恢复码 + 新主密码 →
  1. 读取 LocalAuthBlob
  2. Argon2id(recoveryCode, recoverySalt) → recoveryKek
  3. Argon2id(recoveryCode) → recoveryHash'
  4. constantTimeEqual(recoveryHash', blob.recoveryHash)
     - 失败 → 拒绝
     - 成功 → 继续
  5. AES-GCM(recoveryKek).decrypt(wrappedMasterKey) → masterKey  ← 解封原 masterKey
  6. 重新生成新的 12 位恢复码（一次性使用）
  7. Argon2id(newPassword, newMasterSalt) → newPasswordKek
  8. Argon2id(newRecoveryCode, newRecoverySalt) → newRecoveryKek
  9. AES-GCM(newPasswordKek).encrypt(masterKey) → newPasswordWrappedMasterKey
  10. AES-GCM(newRecoveryKek).encrypt(masterKey) → newWrappedMasterKey
  11. Argon2id(newPassword) → newPasswordHash
  12. Argon2id(newRecoveryCode) → newRecoveryHash
  13. 更新 LocalAuthBlob（masterKey 不变，密文不动）
  14. 单次显示新恢复码，强制用户抄写
```

UI 入口：

- Web：[web/src/screens/StandaloneRecoverScreen.tsx](file:///e:/workspace/dustnote/web/src/screens/StandaloneRecoverScreen.tsx)
- Mobile：[mobile/src/screens/StandaloneRecoverScreen.tsx](file:///e:/workspace/dustnote/mobile/src/screens/StandaloneRecoverScreen.tsx)
- Miniprogram：[miniprogram/src/pages/standalone-recover/index.tsx](file:///e:/workspace/dustnote/miniprogram/src/pages/standalone-recover/index.tsx)

---

## 5. 客户端锁定策略

为防止离线爆破，单机模式在客户端实现锁定：

| 配置项         | 值           | 说明                                       |
| -------------- | ------------ | ------------------------------------------ |
| 失败阈值       | 6 次         | 连续 6 次密码错误触发锁定                  |
| 锁定时长       | 15 分钟      | 锁定期间无法尝试解锁                       |
| 计数器         | 本地存储     | `LocalLockoutState` 持久化到本地存储       |
| 重置条件       | 成功解锁     | 解锁成功后失败计数清零                     |

### 5.1 LocalLockoutState 结构

```typescript
interface LocalLockoutState {
  failedAttempts: number;          // 当前失败次数
  lockedUntil: number | null;      // 锁定截止时间戳（ms），null 表示未锁定
  lastFailedAt: number | null;     // 上次失败时间戳
}
```

### 5.2 离线爆破成本分析

Argon2id 参数（m=64MB, t=3, p=4）单次计算耗时约 0.5-1 秒（取决于设备 CPU）：

- **不锁定**：每秒 1-2 次，6 次尝试约需 3-6 秒
- **锁定 15 分钟**：6 次失败后必须等待 15 分钟，每 15 分钟最多 6 次 = 每小时 24 次
- **每天最多尝试 576 次**：相比不锁定的 86400 次/天，**降速 150 倍**
- **6 位 diceware 恢复码**：7776^6 ≈ 2.2 × 10^23 种组合，即便每秒 1000 次也需 7 × 10^12 年

详细安全模型见 [security.md §17](./security.md)。

---

## 6. 数据备份与恢复

### 6.1 exportBackup

```typescript
async exportBackup(): Promise<Blob>
```

- 序列化 `notes` / `folders` / `tags` / `preferences` 为 JSON
- 使用 masterKey 派生 backupKey（HKDF），AES-256-GCM 加密
- 打包为 ZIP（含 `manifest.json` + `backup.enc`）
- 返回 Blob 供用户下载

### 6.2 importBackup

```typescript
async importBackup(blob: Blob): Promise<void>
```

- 解析 ZIP → 读取 `manifest.json` 校验版本
- 要求用户输入"导出时使用的密码"（即原 masterKey 对应的备份密码）
- 解密 `backup.enc` → 反序列化
- **合并策略**：按 `id` 去重，已存在则跳过，不存在则插入
- 写入 `LocalRepository` 各分区

### 6.3 各端实现

| 端           | 导入导出实现                                                                          |
| ------------ | ------------------------------------------------------------------------------------- |
| Web/Desktop  | [web/src/lib/local-repo.ts](file:///e:/workspace/dustnote/web/src/lib/local-repo.ts)  |
| Mobile       | [mobile/src/lib/io.ts](file:///e:/workspace/dustnote/mobile/src/lib/io.ts)（RNFS + Share） |
| Miniprogram  | [miniprogram/src/lib/local-repo.ts](file:///e:/workspace/dustnote/miniprogram/src/lib/local-repo.ts) |

> Mobile 端通过 `react-native-fs` 写入临时文件，再通过 `react-native-share` 调起系统分享菜单导出。导入则通过文件选择器读取。

---

## 7. 模式切换数据迁移

模式切换**显式触发**（用户在 Settings 中点「迁移数据」按钮），**不自动执行**，避免意外覆盖。

### 7.1 standalone → online

```
用户点击「迁移到联机模式」→
  1. 弹窗确认：当前单机数据将被上传到服务器，是否继续？
  2. 输入服务器地址 + 主密码（联机模式）
  3. 调 /auth/status 检查服务器是否已 setup
     - 已 setup → 提示用户先 /auth/unlock 或换一台空服务器
     - 未 setup → 继续
  4. 调 /auth/setup（联机模式 setup）
  5. 遍历 LocalRepository.loadAll()：
     - createFolder() × N
     - createTag() × N
     - createNote() × N
     - setPreferences()
  6. 验证：RemoteRepository.loadAll() 数据完整
  7. LocalRepository.clearBusinessData()（仅清业务数据，保留 LocalAuthBlob 备查）
  8. mode-store.switchMode('online', serverUrl)
  9. Toast 提示成功，重启 App
```

### 7.2 online → standalone

```
用户点击「迁移到单机模式」→
  1. 弹窗确认：服务器数据将下载到本地，是否继续？
  2. 输入新主密码（单机模式）+ 恢复码
  3. setupLocalAuth(newPassword) → 生成新 LocalAuthBlob
  4. RemoteRepository.exportBackup() → 拉全量密文
  5. 解析 → 写入 LocalRepository
  6. 验证：LocalRepository.loadAll() 数据完整
  7. mode-store.switchMode('standalone')
  8. Toast 提示成功，重启 App
```

### 7.3 失败回滚

迁移过程原子化，任一步骤失败：

- 已写入的目标 Repository 调用 `clearBusinessData()` 回滚
- 通知用户失败原因
- 不修改 `mode-store`，用户仍处于原模式

---

## 8. 限制说明

单机模式由于不依赖服务器，存在以下限制：

| 限制项                     | 说明                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------- |
| 跨设备同步                 | **不支持**。同一账户在不同设备上是完全独立的数据集                                  |
| 在线分享                   | **不支持**。仅支持文件导出（txt/md/html/pdf），无法生成在线分享链接                 |
| 在线备份                   | **不支持**。仅支持本地导出 ZIP（用户需自行管理备份）                                |
| 设备管理                   | **不支持**。UI 中隐藏设备管理入口                                                   |
| 服务器推送通知             | **不支持**                                                                          |
| 多端协同编辑               | **不支持**（联机模式 v2.0 也不支持，未来评估）                                      |
| 小程序单机 10MB 上限       | 受微信平台限制，单 key 10MB；H5 / weapp 端单机模式仅推荐轻量试用                    |
| 数据丢失风险               | 设备丢失 / App 卸载 / 浏览器清理缓存 → 数据全部丢失，**强烈建议定期导出 ZIP 备份** |

### 8.1 用户教育文案

模式选择 UI 中明确告知用户：

> **单机模式适合**：
> - 隐私敏感，不希望数据离开设备
> - 仅在单一设备上使用
> - 想先试用 DustNote 核心功能
>
> **单机模式注意事项**：
> - 数据仅存在本设备，**设备丢失则数据丢失**
> - 不支持跨设备同步
> - 不支持在线分享链接
> - 请定期通过「设置 → 数据 → 导出备份」保存 ZIP
> - 未来可一键迁移到联机模式，不丢数据

---

## 9. 安全模型

### 9.1 离线爆破成本

| 资源             | 攻击者能力                        | DustNote 防护                                              |
| ---------------- | --------------------------------- | ---------------------------------------------------------- |
| 设备物理接触     | 离线爆破 LocalAuthBlob            | Argon2id(m=64MB, t=3, p=4) + 客户端锁定 6 次/15 分钟       |
| 备份文件泄露     | 爆破 exportBackup ZIP             | 用户自定义备份密码（与主密码不同），AES-256-GCM + Argon2id |
| 浏览器存储读取   | XSS 或本地木马读取 IndexedDB      | 所有敏感字段均为密文/哈希，无明文密码                      |
| 内存 dump        | 进程运行时抓取内存                | masterKey 仅在闭包/Web Worker，使用后清零；不写入全局      |

### 9.2 Argon2id 参数

| 参数 | 值       | 含义                                   |
| ---- | -------- | -------------------------------------- |
| m    | 64 MB    | 内存占用，限制 GPU/ASIC 并行爆破       |
| t    | 3        | 迭代次数                               |
| p    | 4        | 并行度                                 |

参数来源：OWASP 2023 推荐，与联机模式服务端密码哈希一致。

### 9.3 与联机模式的安全差异

| 维度         | 单机模式                              | 联机模式                                          |
| ------------ | ------------------------------------- | ------------------------------------------------- |
| 主密码校验   | 客户端 Argon2id 比对                  | 服务端 Argon2id 比对 + JWT 下发                   |
| 锁定策略     | 客户端本地（6 次/15 分钟）            | 服务端 IP + 指纹（5/15/60/240/1440 min 递增）     |
| 备份责任     | 用户完全自主                          | 服务端定期备份 + 用户可导出                       |
| 数据可达性   | 仅设备本地                            | 服务器 + 本地双副本                               |
| 设备丢失风险 | 高（无备份则数据丢失）                | 低（重新登录即可恢复）                            |
| 跨端攻击面   | 仅本设备                              | 网络传输 + 服务端存储（但 E2EE 保证密文安全）     |
| 服务端信任   | **不需要**                            | 必须信任（仅信任密文存储）                        |

完整安全模型见 [security.md](./security.md)。

---

## 10. 关键文件索引

### 10.1 shared 层

- [shared/src/repository.ts](file:///e:/workspace/dustnote/shared/src/repository.ts) — DataRepository 接口契约
- [shared/src/local-auth.ts](file:///e:/workspace/dustnote/shared/src/local-auth.ts) — 单机鉴权工具
- [shared/src/types.ts](file:///e:/workspace/dustnote/shared/src/types.ts) — 类型定义（AppMode/LocalAuthBlob 等）

### 10.2 Web 端

- [web/src/lib/mode-store.ts](file:///e:/workspace/dustnote/web/src/lib/mode-store.ts) — Zustand 模式状态
- [web/src/lib/local-repo.ts](file:///e:/workspace/dustnote/web/src/lib/local-repo.ts) — IndexedDB 实现
- [web/src/lib/remote-repo.ts](file:///e:/workspace/dustnote/web/src/lib/remote-repo.ts) — 封装 ApiClient
- [web/src/lib/repository.ts](file:///e:/workspace/dustnote/web/src/lib/repository.ts) — 工厂函数
- [web/src/lib/local-auth-storage.ts](file:///e:/workspace/dustnote/web/src/lib/local-auth-storage.ts) — LocalAuthBlob 持久化
- [web/src/components/ModeSelectDialog.tsx](file:///e:/workspace/dustnote/web/src/components/ModeSelectDialog.tsx) — 模式选择 UI
- [web/src/screens/StandaloneSetupScreen.tsx](file:///e:/workspace/dustnote/web/src/screens/StandaloneSetupScreen.tsx)
- [web/src/screens/StandaloneUnlockScreen.tsx](file:///e:/workspace/dustnote/web/src/screens/StandaloneUnlockScreen.tsx)
- [web/src/screens/StandaloneRecoverScreen.tsx](file:///e:/workspace/dustnote/web/src/screens/StandaloneRecoverScreen.tsx)

### 10.3 Mobile 端

- [mobile/src/lib/mode-store.ts](file:///e:/workspace/dustnote/mobile/src/lib/mode-store.ts)
- [mobile/src/lib/local-repo.ts](file:///e:/workspace/dustnote/mobile/src/lib/local-repo.ts) — AsyncStorage 实现
- [mobile/src/lib/remote-repo.ts](file:///e:/workspace/dustnote/mobile/src/lib/remote-repo.ts)
- [mobile/src/lib/repository.ts](file:///e:/workspace/dustnote/mobile/src/lib/repository.ts)
- [mobile/src/lib/local-auth-storage.ts](file:///e:/workspace/dustnote/mobile/src/lib/local-auth-storage.ts)
- [mobile/src/screens/ModeSelectScreen.tsx](file:///e:/workspace/dustnote/mobile/src/screens/ModeSelectScreen.tsx)
- [mobile/src/screens/StandaloneSetupScreen.tsx](file:///e:/workspace/dustnote/mobile/src/screens/StandaloneSetupScreen.tsx)
- [mobile/src/screens/StandaloneUnlockScreen.tsx](file:///e:/workspace/dustnote/mobile/src/screens/StandaloneUnlockScreen.tsx)
- [mobile/src/screens/StandaloneRecoverScreen.tsx](file:///e:/workspace/dustnote/mobile/src/screens/StandaloneRecoverScreen.tsx)
- [mobile/src/state/auth.ts](file:///e:/workspace/dustnote/mobile/src/state/auth.ts) — 扩展支持双模式鉴权

### 10.4 Miniprogram 端

- [miniprogram/src/lib/mode-store.ts](file:///e:/workspace/dustnote/miniprogram/src/lib/mode-store.ts)
- [miniprogram/src/lib/local-repo.ts](file:///e:/workspace/dustnote/miniprogram/src/lib/local-repo.ts) — Taro.setStorage 实现
- [miniprogram/src/lib/remote-repo.ts](file:///e:/workspace/dustnote/miniprogram/src/lib/remote-repo.ts)
- [miniprogram/src/lib/repository.ts](file:///e:/workspace/dustnote/miniprogram/src/lib/repository.ts)
- [miniprogram/src/lib/local-auth-storage.ts](file:///e:/workspace/dustnote/miniprogram/src/lib/local-auth-storage.ts)
- [miniprogram/src/pages/mode-select/index.tsx](file:///e:/workspace/dustnote/miniprogram/src/pages/mode-select/index.tsx)
- [miniprogram/src/pages/standalone-setup/index.tsx](file:///e:/workspace/dustnote/miniprogram/src/pages/standalone-setup/index.tsx)
- [miniprogram/src/pages/standalone-unlock/index.tsx](file:///e:/workspace/dustnote/miniprogram/src/pages/standalone-unlock/index.tsx)
- [miniprogram/src/pages/standalone-recover/index.tsx](file:///e:/workspace/dustnote/miniprogram/src/pages/standalone-recover/index.tsx)

### 10.5 Desktop 端

> Desktop 通过 [desktop/src/App.tsx](file:///e:/workspace/dustnote/desktop/src/App.tsx) `import WebApp from '../../web/src/App'` 复用 Web 端全部代码，无独立单机模式实现。

---

## 11. 验证清单

发布前需通过以下验证：

- [ ] Web 单机：清 localStorage → 打开 → 选择「单机使用」→ setup → CRUD → 导出 ZIP → 重新导入 → 数据一致
- [ ] Web 单机 → 联机迁移：上传数据 → 验证服务器有数据
- [ ] Web 联机 → 单机迁移：下载数据 → 验证本地有数据
- [ ] Mobile 单机：首次启动 → ModeSelect → 单机 → setup → CRUD → 系统分享导出
- [ ] Miniprogram 单机（H5 + weapp）：单机 setup → CRUD
- [ ] 单机鉴权：6 次错误密码 → 锁定 15 分钟 → recover 流程
- [ ] 模式切换失败回滚：模拟网络中断 → 验证数据未损坏
- [ ] 模式切换后 UI 路由正确：单机模式隐藏设备管理 / 在线分享入口
