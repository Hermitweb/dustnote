/**
 * 模式切换数据迁移（对齐安卓端 lib/migration.ts，DM-7 延迟迁移 + 重加密）
 *
 * 背景：切换模式后新模式 setup/unlock 会生成**新的** masterKey，旧备份里的密文
 * 绑定旧 key，直接 import 会全部解密失败。
 *
 * 流程：
 * 1. 切换前（settings）：exportBackup → savePendingMigration(backup, oldUserId)
 *    + auth store 暂存 pendingMasterKey（lock() 不清除）→ 才切换模式
 * 2. 新模式 setup/unlock/recover 成功后（auth store 内）调用
 *    consumePendingMigration：用旧 masterKey 解密备份 → 用**新模式当前 masterKey**
 *    重加密导入（standalone 直写保留 ID；online 建文件夹 ID 映射 + 逐条创建）
 * 3. 成功清槽；失败把旧 masterKey 用当前 key 包装写回槽，下次解锁自动重试
 *
 * 本文件只保留**平台 I/O**（Taro 存储、加解密管线、repo 调用）与槽的读写；
 * 账本记账、轮数门禁、槽去留判定等策略统一在 @dustnote/shared/migration
 * （三端单一实现且带单测——这些边界连续三轮审计都出过缺陷）。
 */
import Taro from '@tarojs/taro';
import {
  canClearSlot,
  convertNotesForStandalone,
  decryptString,
  encryptString,
  noteAad,
  openMigrationAttempt,
  runFolderImport,
  runNoteImport,
  unwrapKey,
  wrapKey,
  MAX_MIGRATION_ATTEMPTS,
  type BackupPayload,
  type DataRepository,
  type MigrationSlot,
} from '@dustnote/shared';
import { parseEnvelope } from '@dustnote/client-core';
import { useModeStore } from './mode-store';

/** 待迁移数据槽（持久化；旧 masterKey 只以「新模式 key 包装」的密文形式存放） */
export type PendingMigration = MigrationSlot;

export { MAX_MIGRATION_ATTEMPTS };

const PENDING_KEY = 'dustnote_pending_migration';

/**
 * H2：标记「未完成迁移报告已提示过」——放弃自动重试后不能每次解锁都弹窗。
 * 槽仍保留（failedIds 可供设置页展示与手动重试）。
 */
export function markMigrationReported(): void {
  const slot = loadPendingMigration();
  if (!slot || slot.reportShown) return;
  persistSlot({ ...slot, reportShown: true });
}

export function savePendingMigration(backup: BackupPayload, oldUserId: string | null): void {
  const slot: PendingMigration = { backup, wrappedOldMasterKey: null, oldUserId };
  Taro.setStorageSync(PENDING_KEY, JSON.stringify(slot));
}

/** 把（可能更新过 folderMap / 账本的）槽写回 storage */
function persistSlot(slot: PendingMigration): void {
  Taro.setStorageSync(PENDING_KEY, JSON.stringify(slot));
}

export function loadPendingMigration(): PendingMigration | null {
  try {
    const raw = Taro.getStorageSync(PENDING_KEY) as string;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingMigration;
    if (!parsed.backup || !Array.isArray(parsed.backup.notes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingMigration(): void {
  try {
    Taro.removeStorageSync(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/** 导入失败时把旧 masterKey 用当前 masterKey 包装写回槽，保证重启后可重试 */
export async function persistWrappedOldMasterKey(
  slot: PendingMigration,
  currentMasterKey: Uint8Array,
  oldMasterKey: Uint8Array
): Promise<void> {
  const wrapped = await wrapKey(currentMasterKey, oldMasterKey);
  Taro.setStorageSync(PENDING_KEY, JSON.stringify({ ...slot, wrappedOldMasterKey: wrapped }));
}

/** 解密备份中的一条笔记（兼容 AAD 绑定），失败返回 null */
async function tryDecryptNote(
  ciphertext: string,
  oldKey: Uint8Array,
  oldUserId: string | null,
  noteId: string
): Promise<string | null> {
  try {
    const env = parseEnvelope(ciphertext);
    const aad = env.payload.a === 1 ? noteAad(noteId, oldUserId ?? '') : undefined;
    return await decryptString(oldKey, env.payload, aad);
  } catch {
    return null;
  }
}

/** 用新 masterKey 重加密一条笔记，返回新的密文信封字符串 */
async function reEncrypt(json: string, newKey: Uint8Array): Promise<string> {
  const payload = await encryptString(newKey, json, 1);
  return JSON.stringify({ v: 1, payload });
}

/** 导入到单机模式：重加密后直写本地（保留 ID / folderId / deletedAt，覆盖式） */
async function importToStandalone(
  repo: DataRepository,
  slot: PendingMigration,
  oldKey: Uint8Array,
  newKey: Uint8Array
): Promise<{ imported: number; failed: number }> {
  const { notes, failed } = await convertNotesForStandalone(slot.backup.notes, {
    decrypt: (note) => tryDecryptNote(note.ciphertext, oldKey, slot.oldUserId, note.id),
    reEncrypt: (json) => reEncrypt(json, newKey),
  });
  await repo.clearBusinessData();
  await repo.importBackup({ ...slot.backup, notes });
  return { imported: notes.length, failed };
}

/** 导入到联机模式：先建文件夹（维护 ID 映射），再逐条创建笔记，最后建标签 / 偏好 */
async function importToOnline(
  repo: DataRepository,
  slot: PendingMigration,
  oldKey: Uint8Array,
  newKey: Uint8Array
): Promise<{ imported: number; failed: number; unresolved: number; cleared: boolean }> {
  // folderMap 从槽恢复：失败重试时复用上次映射，不会重复建文件夹
  const folderMap = new Map<string, string>(Object.entries(slot.folderMap ?? {}));
  await runFolderImport(slot.backup.folders ?? [], folderMap, (input) => repo.createFolder(input));
  // 文件夹阶段完成即落盘映射：后续笔记导入失败重试时跳过文件夹阶段
  persistSlot({ ...slot, folderMap: Object.fromEntries(folderMap) });

  const outcome = await runNoteImport({
    notes: slot.backup.notes,
    folderMap,
    importedIds: slot.importedIds,
    failedIds: slot.failedIds,
    deps: {
      decrypt: (note) => tryDecryptNote(note.ciphertext, oldKey, slot.oldUserId, note.id),
      reEncrypt: (json) => reEncrypt(json, newKey),
      createNote: (input) => repo.createNote(input),
      persistLedger: (state) => {
        persistSlot({ ...slot, folderMap: Object.fromEntries(folderMap), ...state });
      },
    },
  });

  for (const tag of slot.backup.tags ?? []) {
    try {
      await repo.createTag(tag.name, tag.color);
    } catch {
      /* 单条失败不影响整体迁移 */
    }
  }
  if (slot.backup.preferences) {
    try {
      await repo.setPreferences(slot.backup.preferences);
    } catch {
      /* 偏好设置失败不阻塞迁移 */
    }
  }

  const cleared = canClearSlot(outcome);
  if (cleared) clearPendingMigration();
  return {
    imported: outcome.imported,
    failed: outcome.failed,
    unresolved: outcome.unresolved,
    cleared,
  };
}

/** 消费待迁移数据（auth store 在新模式鉴权成功后调用） */
export async function consumePendingMigration(
  repo: DataRepository,
  currentMasterKey: Uint8Array,
  oldMasterKey: Uint8Array | null
): Promise<{
  imported: number;
  failed: number;
  unresolved: number;
  cleared: boolean;
  exhausted?: boolean;
} | null> {
  const slot = loadPendingMigration();
  if (!slot) return null;

  // H2：自动重试上限——超过后不再重跑，槽保留为「未完成迁移报告」
  const gate = openMigrationAttempt(slot);
  if (gate.exhausted) {
    return {
      imported: 0,
      failed: gate.failedCount,
      unresolved: gate.failedCount,
      cleared: false,
      exhausted: true,
    };
  }
  // 带 attempts 的「活槽」贯穿本轮：账本落盘是 {...slot} 展开，
  // 传旧引用会把 attempts 抹掉
  const liveSlot: PendingMigration = { ...slot, attempts: gate.attempts };
  persistSlot(liveSlot);

  let oldKey = oldMasterKey;
  if (!oldKey && liveSlot.wrappedOldMasterKey) {
    try {
      oldKey = await unwrapKey(currentMasterKey, liveSlot.wrappedOldMasterKey);
    } catch {
      oldKey = null;
    }
  }
  if (!oldKey) return null; // 无旧 masterKey，无法解密备份，等待下次解锁重试

  const mode = useModeStore.getState().mode;
  if (mode === 'standalone') {
    // 单机路径无账本（覆写式导入，无部分重试的概念）：本轮无失败即可清槽
    const r = await importToStandalone(repo, liveSlot, oldKey, currentMasterKey);
    const cleared = r.failed === 0;
    if (cleared) clearPendingMigration();
    return { ...r, unresolved: 0, cleared };
  }
  // 槽的去留由策略层 canClearSlot 判定（无本轮失败且无历史未解决项），
  // importToOnline 内已清槽。失败保留待重试/报告，由 auth store 按 mode
  // 决定是否放弃，见 M-E。
  return await importToOnline(repo, liveSlot, oldKey, currentMasterKey);
}
