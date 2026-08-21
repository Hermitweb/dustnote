# @dustnote/client-core 迁移指南

> 适用版本：v2.5.5+
> 更新日期：2026-08-19

## 迁移状态

| 客户端        | 信封（envelope） | 离线队列 + 同步引擎 | 冲突合并（409 三方） | 冲突裁决 UI |
| ------------- | ---------------- | ------------------- | -------------------- | ----------- |
| web           | ✅ 已迁移        | ✅ 已迁移           | ✅ 已迁移            | ✅ 已实现    |
| mobile (RN)   | ✅ 已迁移        | ✅ 已迁移           | ✅ 已迁移            | ✅ 已实现    |
| miniprogram   | ✅ 已迁移        | ✅ 已新增           | ✅ 已迁移            | ✅ 已实现    |
| desktop       | ✅ 复用 web      | ✅ 复用 web         | ✅ 复用 web          | ✅ 复用 web  |

> 三端冲突处理策略一致：无歧义字段自动合并并静默 re-PATCH；有歧义字段
> （双方都改）推送到 conflict-store，由全局 ConflictDialog 让用户裁决
> （local / server / merged），严格优于旧的静默丢弃，不丢数据。

## 0. 背景：为什么需要 client-core

DustNote 有四个客户端（web / mobile / miniprogram / desktop），它们各自维护了一套：

1. **离线同步队列** — web 用 IndexedDB、mobile 用 AsyncStorage、miniprogram 用 Taro.setStorage，逻辑重复且行为不一致（mobile 无指数退避、miniprogram 无离线队列）
2. **加密信封格式** — 四端各自实现 `encryptNote`/`decryptNote`/`parseEnvelope`，信封格式靠口头约定保持一致，改一处需手动同步四端
3. **冲突处理** — 全端 409 静默丢弃 + loadAll 覆盖，多设备离线编辑同一篇笔记时会**静默丢数据**

`@dustnote/client-core` 把这三块抽成框架无关的纯逻辑包，四端共用：

| 模块              | 解决的问题               | 关键导出                                           |
| ----------------- | ----------------------- | -------------------------------------------------- |
| `offline-queue`   | 队列语义与存储解耦       | `OfflineQueue`, `QueueStorage`, `IndexedDbQueueStorage`, `MemoryQueueStorage` |
| `sync-engine`     | 重放编排与退避策略       | `SyncEngine`, `SyncEngineHooks`, `FlushSummary`    |
| `crypto-backend`  | 加密后端可替换适配器     | `CryptoBackend`, `sharedCryptoBackend`, `setCryptoBackend` |
| `envelope`        | 信封格式单一真相源       | `encryptNote`, `decryptNote`, `parseEnvelope`, `ENVELOPE_VERSION` |
| `conflict`        | 字段级 3-way 合并        | `resolveConflict`, `toMergeable`, `MergeableNote`  |

## 1. Web 迁移（已完成，参考实现）

Web 是第一个迁移到 client-core 的客户端，作为其余端的参考。

### 1.1 信封 + 加密（envelope / crypto-backend）

**改动**：删除 `store.ts` 中本地定义的 `NoteCipherEnvelope` 接口、`ENVELOPE_VERSION`、`encryptNote`、`decryptNote`、`parseEnvelope`，改为从 `@dustnote/client-core` 导入。

```ts
// 旧：本地实现
const ENVELOPE_VERSION = 1;
export interface NoteCipherEnvelope { v: number; payload: Ciphertext }
async function encryptNote(key, plaintext, aad?) { ... }
async function decryptNote(key, envelope, aad?) { ... }
function parseEnvelope(raw: string) { ... }

// 新：从 client-core 导入
import { encryptNote, decryptNote, parseEnvelope, type NoteCipherEnvelope } from '@dustnote/client-core';
```

**效果**：信封格式由 client-core 单一定义，四端共享。crypto-backend 默认委托给 `@dustnote/shared` 的 WebCrypto 实现，无需额外配置。如果未来 desktop 的 Rust 加密后端需要替换，调用 `setCryptoBackend(rustBackend)` 即可。

### 1.2 离线队列（offline-queue）

**改动**：`web/src/lib/offline-queue.ts` 从自实现（idb-keyval + 手写内存缓存 + BroadcastChannel）改为委托 client-core 的 `OfflineQueue` + `IndexedDbQueueStorage`。

```ts
// 新的 web 适配层（仅 ~80 行，全是委托）
import { IndexedDbQueueStorage, OfflineQueue, ... } from '@dustnote/client-core';

const storage = new IndexedDbQueueStorage();  // DB/store/key 与 idb-keyval 默认一致
const queue = new OfflineQueue(storage);

// 跨标签页失效
if (typeof BroadcastChannel !== 'undefined') {
  new BroadcastChannel('dustnote-queue').onmessage = () => queue.invalidate();
}

// 模块函数委托（签名不变，store.ts 零改动）
export function enqueue(op) { return queue.enqueue(op); }
export function peekAll() { return queue.peekAll(); }
// ...
```

**关键设计**：`IndexedDbQueueStorage` 的 DB 名（`keyval-store`）、store 名（`keyval`）、key（`dustnote:offline-queue`）与旧 idb-keyval 实现完全一致，web 切换后已有 pending 队列**无缝继承，无需数据迁移**。

### 1.3 冲突合并（conflict）

**改动**：

1. `updateNote` 入队时携带 `conflictCtx`（base + local 的 `MergeableNote`）
2. `flushQueue` 409 分支调用 `handleNoteConflict` 做字段级 3-way 合并
3. 新增 `pendingConflicts` store 状态 + `resolveConflictChoice` / `dismissConflict` 动作

```ts
// updateNote：入队时捕获三方合并上下文
const conflictCtx: ConflictContext | undefined = current ? {
  noteId: id,
  baseVersion: note.version,
  base: toMergeable(id, current, { isPinned: note.isPinned, ... }),
  local: toMergeable(id, merged, { isPinned: patch.isPinned ?? note.isPinned, ... }),
} : undefined;

// flushQueue 409 分支：字段级合并
if (status === 409) {
  if (op.conflictCtx) {
    await handleNoteConflict(op, err);  // 解密 server current → resolveConflict → 自动 re-PATCH 或推 pendingConflicts
  }
  await remove(op.id);
  hadConflict = true;
}
```

**冲突处理流程**：

```
409 响应 (含 server current NoteRow)
    │
    ▼
解密 server ciphertext → serverMergeable
    │
    ▼
resolveConflict(base, local, server)
    │
    ├── hasConflicts === false → 自动 re-PATCH merged（用 server version）
    │
    └── hasConflicts === true  → 应用 merged 为暂存态 + 推入 pendingConflicts
                                   → UI 展示 diff，用户选择 local/server/merged
                                   → resolveConflictChoice() re-PATCH
```

## 2. Mobile（React Native）迁移指南

### 前置条件

- `mobile/package.json` 添加 `"@dustnote/client-core": "workspace:*"`
- 运行 `pnpm install`（或手动创建 junction：`mobile/node_modules/@dustnote/client-core` → `client-core/`）

### 步骤 1：信封迁移

删除 mobile store 中本地定义的 `encryptNote` / `decryptNote` / `parseEnvelope` / `NoteCipherEnvelope`，改为从 `@dustnote/client-core` 导入。与 web 1.1 完全相同。

### 步骤 2：离线队列迁移

mobile 当前的 `src/lib/offline-queue.ts` 使用 AsyncStorage 且缺少指数退避。迁移方式：

```ts
// mobile/src/lib/offline-queue.ts（新）
import { OfflineQueue, type QueueStorage, ... } from '@dustnote/client-core';
import AsyncStorage from '@react-native-async-storage/async-storage';

// AsyncStorage 适配器
class AsyncStorageQueueStorage implements QueueStorage {
  private readonly key = 'dustnote:offline-queue';

  async load(): Promise<QueuedOp[]> {
    const raw = await AsyncStorage.getItem(this.key);
    return raw ? JSON.parse(raw) : [];
  }
  async save(ops: QueuedOp[]): Promise<void> {
    await AsyncStorage.setItem(this.key, JSON.stringify(ops));
  }
  async clear(): Promise<void> {
    await AsyncStorage.removeItem(this.key);
  }
}

const queue = new OfflineQueue(new AsyncStorageQueueStorage());
// 模块函数委托（与旧签名对齐）
```

**注意**：mobile 旧队列的 key 是 `dustnote_offline_queue`（下划线），client-core 默认 `dustnote:offline-queue`（冒号）。迁移时需：
- 要么在 `AsyncStorageQueueStorage` 构造时传入旧 key 保持兼容
- 要么做一次性迁移：读取旧 key → 写入新 key → 删除旧 key

### 步骤 3：（可选）SyncEngine 迁移

如果 mobile 的 flushQueue 逻辑与 web 差异较大，可以直接使用 `SyncEngine`：

```ts
import { SyncEngine, OfflineQueue, type SyncEngineHooks } from '@dustnote/client-core';

const engine = new SyncEngine(queue, {
  replayOp: (op) => api.request(op.method, op.path, op.body),
  onConflict: async (op, serverData) => { /* 同 web handleNoteConflict */ },
  onFlushed: (summary) => { /* loadAll / 标记在线 */ },
  // classifyError 默认识别 ApiException，RN 也可用默认
});
```

### 步骤 4：冲突合并

与 web 相同：在 `updateNote` 入队时捕获 `conflictCtx`，在 409 处理时调用 `resolveConflict`。

## 3. Miniprogram（Taro）迁移指南

### 前置条件

- `miniprogram/package.json` 添加 `"@dustnote/client-core": "workspace:*"`
- 运行 `pnpm install`（或手动创建 junction）

### 步骤 1：信封迁移

同 web / mobile，从 client-core 导入 `encryptNote` / `decryptNote` / `parseEnvelope`。

### 步骤 2：离线队列（新增）

miniprogram 当前**没有离线队列**。可以直接用 client-core 实现：

```ts
// miniprogram/src/lib/offline-queue.ts（新增）
import { OfflineQueue, type QueueStorage, ... } from '@dustnote/client-core';
import Taro from '@tarojs/taro';

class TaroQueueStorage implements QueueStorage {
  private readonly key = 'dustnote:offline-queue';

  async load(): Promise<QueuedOp[]> {
    const { data } = await Taro.getStorage({ key: this.key }).catch(() => ({ data: null }));
    return Array.isArray(data) ? data : [];
  }
  async save(ops: QueuedOp[]): Promise<void> {
    await Taro.setStorage({ key: this.key, data: ops });
  }
  async clear(): Promise<void> {
    await Taro.removeStorage({ key: this.key });
  }
}

const queue = new OfflineQueue(new TaroQueueStorage());
```

### 步骤 3：加密后端（无需注入）

miniprogram 不需要自定义 CryptoBackend。原因：`@dustnote/shared` 的 AES-GCM /
Argon2id / HKDF 全部基于 **纯 JS 库**（`@noble/ciphers` + `@noble/hashes`），
不依赖 WebCrypto，因此 client-core 默认的 `sharedCryptoBackend` 在小程序环境
直接可用。

唯一需要小程序的点已被 `src/lib/crypto-polyfill.ts` 处理：用 `setSecureRandomSource`
注入微信安全随机源（`wx.getUserCryptoManager().getRandomValues()`），使
`randomBytes` 在无 `crypto.getRandomValues` 的环境也能工作。client-core 的
`sharedCryptoBackend.randomBytes` 内部走 shared 的 `randomBytes`，会自动使用
该注入源，无需额外配置。

> 仅当需要换用原生加密后端（如未来 desktop 的 Rust 实现）时，才调用
> `setCryptoBackend(customBackend)` 注入。

## 4. 模块 API 速查

### OfflineQueue

```ts
class OfflineQueue {
  constructor(storage: QueueStorage)
  enqueue(op: Omit<QueuedOp, 'id' | 'createdAt' | 'retries'>): Promise<QueuedOp>
  peek(): Promise<QueuedOp | undefined>
  peekAll(): Promise<QueuedOp[]>
  remove(id: string): Promise<void>
  bumpRetries(id: string, max?: number): Promise<void>
  getRetryDelayForOp(id: string): Promise<number>
  clear(): Promise<void>
  size(): Promise<number>
  invalidate(): void  // 丢弃内存缓存，下次从存储重新加载
}
```

### SyncEngine

```ts
class SyncEngine {
  constructor(queue: OfflineQueue, hooks: SyncEngineHooks)
  flush(): Promise<FlushSummary>  // 重入守卫 + 串行重放 + 退避 + 409 合并
}

interface SyncEngineHooks {
  replayOp(op: QueuedOp): Promise<unknown>
  onConflict?(op: QueuedOp, serverData: unknown): Promise<boolean>
  onFlushed?(summary: FlushSummary): void
  classifyError?(err: unknown): ErrorClass | null
}
```

### resolveConflict

```ts
function resolveConflict(base: MergeableNote, local: MergeableNote, server: MergeableNote): ConflictResult

interface ConflictResult {
  merged: MergeableNote       // 最佳努力合并（无冲突时可直接应用）
  conflicts: FieldConflict[]  // 需用户裁决的字段
  hasConflicts: boolean
}
```

### CryptoBackend

```ts
interface CryptoBackend {
  randomBytes(n: number): Uint8Array
  encryptString(key: Uint8Array, plaintext: string, keyVersion?: number, aad?: Uint8Array): Promise<Ciphertext>
  decryptString(key: Uint8Array, blob: Ciphertext, aad?: Uint8Array): Promise<string>
  noteAad(entityId: string, userId: string): Uint8Array
}

// 默认使用 shared 的 WebCrypto 实现
setCryptoBackend(customBackend)  // 替换为 native/polyfill 实现
```

## 5. 注意事项

1. **Node 版本**：client-core 构建需 Node 20–23（`engines` 锁定 >=20 <24，Node 24 会让 better-sqlite3 崩溃）。CI 用 Node 20。
2. **exactOptionalPropertyTypes**：`conflictCtx` 是可选属性，传 `undefined` 会报错。用条件展开：`...(ctx ? { conflictCtx: ctx } : {})`。
3. **队列 key 兼容**：web 的 `IndexedDbQueueStorage` 默认参数与 idb-keyval 一致，无缝继承。mobile 的 AsyncStorage key 不同（下划线 vs 冒号），需显式传旧 key 或做一次性迁移。
4. **409 响应格式**：服务端 PATCH /notes/:id 的 409 响应体包含 `current`（完整 NoteRow 含密文），client-core 依赖此格式做解密 + 合并。服务端无需改动。
5. **loadAll 与 pendingConflicts**：flushQueue 中如果有待裁决冲突（`pendingConflicts.length > 0`），不能调 loadAll（会覆盖暂存态）。web 已处理此 case。
