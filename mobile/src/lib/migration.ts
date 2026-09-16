/**
 * 模式切换数据迁移（v2.4.4 修复：迁移后密文不可解密）
 *
 * 背景：
 * 旧流程「导出备份 → 切换模式 → clearBusinessData → importBackup → lock()」存在严重缺陷：
 * lock() 清空内存 masterKey 后，新模式的 setup/unlock 会生成一把**新的** masterKey，
 * 而备份里的 NoteRow 密文绑定的是**旧** masterKey → 迁移后全部笔记 🔒 解密失败。
 *
 * 方案（延迟迁移 + 重加密，对所有场景都正确）：
 * 1. 迁移时（SettingsScreen）只做低风险步骤：
 *    - 导出旧模式数据（backup）
 *    - 把旧 masterKey 副本放入内存 pending（auth store，lock() 不清除它）
 *    - 把 backup + 旧 userId 持久化到 AsyncStorage（pending slot）
 *    然后才切换模式 + lock()。所有可能失败的步骤都发生在切换之前 → DM-7 原子化。
 * 2. 新模式 setup / unlock / recover 成功后（auth store 内）消费 pending：
 *    - 用内存中的旧 masterKey（或 slot 中「新模式 masterKey 包装的旧 masterKey」）解密备份笔记
 *    - 用**新模式当前的 masterKey**（即新的权威密钥）重新加密后导入
 *      （standalone 直写本地并保留 ID；online 走 API，并重建文件夹 ID 映射）
 * 3. 成功后清除 pending slot；失败（如网络不可用）则把旧 masterKey 用当前 masterKey
 *    包装后写回 slot，App 重启后仍可在下次解锁时自动重试。
 *
 * 为什么是重加密而不是「保留旧 masterKey」：
 * - 迁移目标模式的 masterKey 成为唯一权威密钥，新模式下新建的笔记、服务端已有的
 *   旧笔记（联机账户已存在时）全部可用同一把密钥解密，不会出现混密钥。
 * - 不需要改服务端 wrappedMasterKey（无需 rewrap 接管），单机模式也不需要改 LocalAuthBlob。
 * - 迁移后所有笔记（旧 + 新 + 服务端已有的）都可正常解密，不出现「🔒 解密失败」。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  decryptString,
  encryptString,
  unwrapKey,
  wrapKey,
  noteAad,
  type BackupPayload,
  type Ciphertext,
  type NoteRow,
} from '@dustnote/shared';
import { LocalRepository } from './local-repo';
import { RemoteRepository } from './remote-repo';
import { useModeStore } from './mode-store';
import { parseEnvelope } from './envelope';

const PENDING_KEY = 'dustnote_pending_migration';

/** 待迁移数据槽（持久化到 AsyncStorage；masterKey 只以密文形式存放） */
export interface PendingMigration {
  backup: BackupPayload;
  /** 用「新模式 masterKey」包装的旧 masterKey（首次迁移为 null；导入失败后写入，供重启重试） */
  wrappedOldMasterKey: Ciphertext | null;
  /** 旧模式 userId（用于解密 AAD 绑定的旧密文；standalone 为 null） */
  oldUserId: string | null;
  /** 联机迁移的旧→新文件夹 id 映射（H-D：不持久化则失败重试会重复建文件夹） */
  folderMap?: Record<string, string>;
  /**
   * H2/H3 迁移账本：已成功导入的笔记 id。重试时跳过这些 id——
   * ① 不再每次解锁全量重传（千条笔记=数十秒+整库流量）；
   * ② 用户已永久删除的笔记不会被按备份复活（原 id POST 会重建行）。
   */
  importedIds?: string[];
  /** 确定性失败的笔记 id（解密失败/超长被服务端拒），用于「未完成迁移」报告 */
  failedIds?: string[];
  /** 已尝试轮数；超过 MAX_MIGRATION_ATTEMPTS 后停止自动重试 */
  attempts?: number;
  /** 放弃后是否已提示过用户（避免每次解锁重复弹窗） */
  reportShown?: boolean;
}

/** 自动重试上限（H2）：超过后保留槽作为「未完成迁移报告」,不再每轮解锁重跑 */
export const MAX_MIGRATION_ATTEMPTS = 3;

/** 迁移时保存待迁移数据（发生在模式切换之前） */
export async function savePendingMigration(
  backup: BackupPayload,
  oldUserId: string | null
): Promise<void> {
  const slot: PendingMigration = { backup, wrappedOldMasterKey: null, oldUserId };
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(slot));
}

/** 读取待迁移数据槽；不存在 / 损坏返回 null */
export async function loadPendingMigration(): Promise<PendingMigration | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingMigration;
    if (!parsed.backup || !Array.isArray(parsed.backup.notes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 清除待迁移数据槽（迁移成功后调用） */
export async function clearPendingMigration(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_KEY);
}

/** 把旧 masterKey 用当前 masterKey 包装后写回槽（导入失败时调用，保证重启后可重试） */
export async function persistWrappedOldMasterKey(
  slot: PendingMigration,
  currentMasterKey: Uint8Array,
  oldMasterKey: Uint8Array
): Promise<void> {
  const wrapped = await wrapKey(currentMasterKey, oldMasterKey);
  await AsyncStorage.setItem(
    PENDING_KEY,
    JSON.stringify({ ...slot, wrappedOldMasterKey: wrapped })
  );
}

/** 把（可能更新过 folderMap 的）槽整体写回（H-D：文件夹阶段完成即落盘） */
async function persistSlot(slot: PendingMigration): Promise<void> {
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(slot));
}

/**
 * H2：标记「未完成迁移报告已提示过」——放弃自动重试后,不能每次解锁都弹窗。
 * 槽仍保留（failedIds 可供设置页展示与手动重试）。
 */
export async function markMigrationReported(): Promise<void> {
  const slot = await loadPendingMigration();
  if (!slot || slot.reportShown) return;
  await persistSlot({ ...slot, reportShown: true }).catch(() => undefined);
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
  const repo = new LocalRepository();
  await repo.clearBusinessData();
  await repo.importBackup({ ...slot.backup, notes });
  return { imported: notes.length, failed };
}

/** 导入到联机模式：先建文件夹（维护 ID 映射），再逐条创建笔记，最后建标签 / 偏好 */
async function importToOnline(
  slot: PendingMigration,
  oldKey: Uint8Array,
  newKey: Uint8Array
): Promise<{ imported: number; failed: number }> {
  const repo = new RemoteRepository();
  // folderMap 从槽恢复：失败重试时复用上次映射,不会重复建文件夹（H-D）
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
  await persistSlot({ ...slot, folderMap: Object.fromEntries(folderMap) });

  // H2/H3：账本——已导入的 id 跳过（不重传、不让已永久删除的笔记复活）
  const doneIds = new Set<string>(slot.importedIds ?? []);
  const failedIds = new Set<string>(slot.failedIds ?? []);
  let imported = 0;
  let failed = 0;
  let sincePersist = 0;
  const flushLedger = async () => {
    sincePersist = 0;
    // 账本落盘失败不致命：最坏情况是重试时重传最近若干条（服务端幂等收敛）
    await persistSlot({
      ...slot,
      folderMap: Object.fromEntries(folderMap),
      importedIds: Array.from(doneIds),
      failedIds: Array.from(failedIds),
    }).catch(() => undefined);
  };

  for (const note of slot.backup.notes) {
    // 已软删的笔记跳过（与服务端 importBackup 行为一致，不恢复回收站垃圾）
    if (note.deletedAt) continue;
    if (doneIds.has(note.id)) continue; // 上一轮已成功
    const json = await tryDecryptNote(note.ciphertext, oldKey, slot.oldUserId, note.id);
    if (json === null) {
      failed++;
      failedIds.add(note.id);
      continue;
    }
    try {
      await repo.createNote({
        // 保留原 id（H-D）：服务端 POST /notes 已幂等（ON CONFLICT 收敛）,
        // 失败重试不会产生重复笔记
        id: note.id,
        ciphertext: await reEncrypt(json, newKey),
        keyVersion: 1,
        isPinned: note.isPinned,
        isFavorite: note.isFavorite,
        folderId: note.folderId ? (folderMap.get(note.folderId) ?? null) : null,
      });
      imported++;
      doneIds.add(note.id);
      failedIds.delete(note.id);
      // 每 25 条落一次账本：进程被杀时最多重传 25 条（幂等,无副作用）
      if (++sincePersist >= 25) await flushLedger();
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
  // 收尾落账本：本轮成功的 id 必须持久化,否则下轮重试会重传（并可能复活
  // 用户已永久删除的笔记）
  await flushLedger();
  return { imported, failed };
}

/**
 * 消费待迁移数据（新模式 setup / unlock / recover 成功后调用）。
 *
 * @param currentMasterKey 新模式当前的 masterKey（权威密钥）
 * @param oldMasterKey     内存中的旧 masterKey（可能为 null → 尝试从 slot 解封）
 * @returns 迁移结果；无待迁移数据返回 null
 */
export async function consumePendingMigration(
  currentMasterKey: Uint8Array,
  oldMasterKey: Uint8Array | null
): Promise<{ imported: number; failed: number; exhausted?: boolean } | null> {
  const slot = await loadPendingMigration();
  if (!slot) return null;

  // H2：自动重试上限——超过后不再重跑导入,槽保留为「未完成迁移报告」
  // （failedIds 可展示）,由 auth store 提示一次并停止每次解锁的弹窗/重传
  const attempts = (slot.attempts ?? 0) + 1;
  if (attempts > MAX_MIGRATION_ATTEMPTS) {
    return { imported: 0, failed: (slot.failedIds ?? []).length, exhausted: true };
  }
  // 用带 attempts 的「活槽」贯穿本轮：importToOnline 的账本落盘是 {...slot}
  // 展开,传旧引用会把 attempts 抹掉
  const liveSlot: PendingMigration = { ...slot, attempts };
  await persistSlot(liveSlot).catch(() => undefined);

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
  const result =
    mode === 'standalone'
      ? await importToStandalone(liveSlot, oldKey, currentMasterKey)
      : await importToOnline(liveSlot, oldKey, currentMasterKey);

  // H-D：failed>0 时不清槽——联机路径 importToOnline 已把 folderMap/账本落盘,
  // 此前无条件清槽导致失败笔记永久丢失（且重试会重复建文件夹）。
  // 槽的去留由 auth store 按 mode 决定（联机保留重试 / 单机确定性失败放弃）。
  if (result.failed === 0) {
    await clearPendingMigration();
  }
  return result;
}
