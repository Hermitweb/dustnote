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
 */
import Taro from '@tarojs/taro';
import {
  decryptString,
  encryptString,
  unwrapKey,
  wrapKey,
  noteAad,
  type BackupPayload,
  type Ciphertext,
  type DataRepository,
  type NoteRow,
} from '@dustnote/shared';
import { parseEnvelope } from '@dustnote/client-core';
import { useModeStore } from './mode-store';

const PENDING_KEY = 'dustnote_pending_migration';

/** 待迁移数据槽（持久化；旧 masterKey 只以「新模式 key 包装」的密文形式存放） */
export interface PendingMigration {
  backup: BackupPayload;
  wrappedOldMasterKey: Ciphertext | null;
  oldUserId: string | null;
  /** 联机迁移的旧→新文件夹 id 映射（C1b：不持久化则失败重试会重复建文件夹） */
  folderMap?: Record<string, string>;
}

export function savePendingMigration(backup: BackupPayload, oldUserId: string | null): void {
  const slot: PendingMigration = { backup, wrappedOldMasterKey: null, oldUserId };
  Taro.setStorageSync(PENDING_KEY, JSON.stringify(slot));
}

/** 把（可能更新过 folderMap 的）槽写回 storage */
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
  const notes: NoteRow[] = [];
  let failed = 0;
  for (const note of slot.backup.notes) {
    const json = await tryDecryptNote(note.ciphertext, oldKey, slot.oldUserId, note.id);
    if (json === null) {
      failed++;
      continue;
    }
    notes.push({
      ...note,
      ciphertext: await reEncrypt(json, newKey),
      keyVersion: 1,
    });
  }
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
): Promise<{ imported: number; failed: number }> {
  // folderMap 从槽恢复：失败重试时复用上次映射,不会重复建文件夹
  const folderMap = new Map<string, string>(Object.entries(slot.folderMap ?? {}));
  for (const folder of slot.backup.folders ?? []) {
    if (folderMap.has(folder.id)) continue;
    const parentId = folder.parentId ? (folderMap.get(folder.parentId) ?? null) : null;
    try {
      const newId = await repo.createFolder({
        name: folder.name,
        parentId,
        icon: folder.icon,
      });
      folderMap.set(folder.id, newId);
    } catch {
      /* 单条失败不影响整体迁移 */
    }
  }
  // 文件夹阶段完成即落盘映射：后续笔记导入失败重试时跳过文件夹阶段
  persistSlot({ ...slot, folderMap: Object.fromEntries(folderMap) });

  let imported = 0;
  let failed = 0;
  for (const note of slot.backup.notes) {
    // 已软删的笔记跳过（与服务端 importBackup 行为一致，不恢复回收站垃圾）
    if (note.deletedAt) continue;
    const json = await tryDecryptNote(note.ciphertext, oldKey, slot.oldUserId, note.id);
    if (json === null) {
      failed++;
      continue;
    }
    try {
      await repo.createNote({
        // 保留原 id（C1b）：服务端 POST /notes 已幂等（ON CONFLICT 收敛）,
        // 失败重试不会产生重复笔记;同时密文若带 AAD 绑定也以原 id 为准
        id: note.id,
        ciphertext: await reEncrypt(json, newKey),
        keyVersion: 1,
        isPinned: note.isPinned,
        isFavorite: note.isFavorite,
        folderId: note.folderId ? (folderMap.get(note.folderId) ?? null) : null,
      });
      imported++;
    } catch {
      failed++;
    }
  }

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
  return { imported, failed };
}

/** 消费待迁移数据（auth store 在新模式鉴权成功后调用） */
export async function consumePendingMigration(
  repo: DataRepository,
  currentMasterKey: Uint8Array,
  oldMasterKey: Uint8Array | null
): Promise<{ imported: number; failed: number } | null> {
  const slot = loadPendingMigration();
  if (!slot) return null;

  let oldKey = oldMasterKey;
  if (!oldKey && slot.wrappedOldMasterKey) {
    try {
      oldKey = await unwrapKey(currentMasterKey, slot.wrappedOldMasterKey);
    } catch {
      oldKey = null;
    }
  }
  if (!oldKey) return null; // 无旧 masterKey，无法解密备份，等待下次解锁重试

  const mode = useModeStore.getState().mode;
  const result =
    mode === 'standalone'
      ? await importToStandalone(repo, slot, oldKey, currentMasterKey)
      : await importToOnline(repo, slot, oldKey, currentMasterKey);

  clearPendingMigration();
  return result;
}
