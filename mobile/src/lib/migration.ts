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
 *
 * 本文件只保留**平台 I/O**（AsyncStorage、加解密管线、repo 调用）与槽的读写；
 * 账本记账、轮数门禁、槽去留判定等策略统一在 @dustnote/shared/migration
 * （三端单一实现且带单测——这些边界连续三轮审计都出过缺陷）。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
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
  type MigrationSlot,
} from '@dustnote/shared';
import { LocalRepository } from './local-repo';
import { RemoteRepository } from './remote-repo';
import { useModeStore } from './mode-store';
import { parseEnvelope } from './envelope';

const PENDING_KEY = 'dustnote_pending_migration';

/** 待迁移数据槽（持久化到 AsyncStorage；masterKey 只以密文形式存放） */
export type PendingMigration = MigrationSlot;

export { MAX_MIGRATION_ATTEMPTS };

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

/** 把（可能更新过 folderMap / 账本的）槽整体写回 */
async function persistSlot(slot: PendingMigration): Promise<void> {
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(slot));
}

/**
 * H2：标记「未完成迁移报告已提示过」——放弃自动重试后，不能每次解锁都弹窗。
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
  const { notes, failed } = await convertNotesForStandalone(slot.backup.notes, {
    decrypt: (note) => tryDecryptNote(note.ciphertext, oldKey, slot.oldUserId, note.id),
    reEncrypt: (json) => reEncrypt(json, newKey),
  });
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
): Promise<{ imported: number; failed: number; unresolved: number; cleared: boolean }> {
  const repo = new RemoteRepository();
  // folderMap 从槽恢复：失败重试时复用上次映射，不会重复建文件夹
  const folderMap = new Map<string, string>(Object.entries(slot.folderMap ?? {}));
  await runFolderImport(slot.backup.folders ?? [], folderMap, (input) => repo.createFolder(input));
  // 文件夹阶段完成即落盘映射：后续笔记导入失败重试时跳过文件夹阶段
  await persistSlot({ ...slot, folderMap: Object.fromEntries(folderMap) });

  const outcome = await runNoteImport({
    notes: slot.backup.notes,
    folderMap,
    importedIds: slot.importedIds,
    failedIds: slot.failedIds,
    deps: {
      decrypt: (note) => tryDecryptNote(note.ciphertext, oldKey, slot.oldUserId, note.id),
      reEncrypt: (json) => reEncrypt(json, newKey),
      createNote: (input) => repo.createNote(input),
      persistLedger: async (state) => {
        // 账本落盘失败不致命：最坏情况是重试时重传最近若干条（服务端幂等收敛）
        await persistSlot({
          ...slot,
          folderMap: Object.fromEntries(folderMap),
          ...state,
        }).catch(() => undefined);
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
  if (cleared) await clearPendingMigration();
  return {
    imported: outcome.imported,
    failed: outcome.failed,
    unresolved: outcome.unresolved,
    cleared,
  };
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
): Promise<{
  imported: number;
  failed: number;
  unresolved: number;
  cleared: boolean;
  exhausted?: boolean;
} | null> {
  const slot = await loadPendingMigration();
  if (!slot) return null;

  // H2：自动重试上限——超过后不再重跑导入，槽保留为「未完成迁移报告」
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
  // 用带 attempts 的「活槽」贯穿本轮：账本落盘是 {...slot} 展开，
  // 传旧引用会把 attempts 抹掉
  const liveSlot: PendingMigration = { ...slot, attempts: gate.attempts };
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
  if (mode === 'standalone') {
    // 单机路径无账本（覆写式导入，无部分重试的概念）：本轮无失败即可清槽
    const r = await importToStandalone(liveSlot, oldKey, currentMasterKey);
    const cleared = r.failed === 0;
    if (cleared) await clearPendingMigration();
    return { ...r, unresolved: 0, cleared };
  }
  // 槽的去留由策略层 canClearSlot 判定（无本轮失败且无历史未解决项），
  // importToOnline 内已清槽。失败时保留待重试/报告，由 auth store 按 mode
  // 决定是否放弃（联机保留重试 / 单机确定性失败放弃，见 M-E）。
  return await importToOnline(liveSlot, oldKey, currentMasterKey);
}
