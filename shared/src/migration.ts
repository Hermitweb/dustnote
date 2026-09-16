/**
 * 模式切换迁移的**策略层**（跨端单一实现）
 *
 * 为什么存在：三端（web / mobile / 小程序）的「延迟迁移 + 重加密」流程此前各自
 * 复制了同一套账本逻辑，连续三轮审计都在账本边界上出过缺陷——无限重试、
 * 用户已删除的笔记被备份复活、失败计数与槽的去留判断不一致。
 *
 * 这里只承载**决策**，平台侧注入 I/O（加解密、repo 调用、存储落盘），
 * 于是下列不变式可以被 shared 的单元测试直接钉住：
 *
 * 1. 已导入的 id 永不重传（幂等；同时避免用户已永久删除的笔记被备份复活）
 * 2. 解密的确定性失败只在**密钥已被证实正确**时记账
 *    （本轮有任意一条成功解密 → 密钥对；全部失败 → 通常是密钥不对，不记账，
 *    否则密钥修好后这些笔记会被永久跳过，再也迁不回来）
 * 3. 槽的清除非「本轮无失败 **且** 无历史未解决项」——只看本轮失败会在
 *    剩余项全是历史确定性失败时误清槽，导致失败笔记静默丢失
 * 4. 账本按固定条数间隔落盘：进程被杀最多重传该间隔条数（服务端幂等收敛）
 * 5. 尝试轮数超上限后不再自动重跑，槽保留为「未完成迁移报告」
 */

import type { NoteRow, Folder } from './types.js';
import type { Ciphertext } from './crypto.js';
import type { BackupPayload } from './repository.js';

/** 自动重试上限：超过后保留槽作为「未完成迁移报告」，不再每轮解锁重跑 */
export const MAX_MIGRATION_ATTEMPTS = 3;

/** 账本落盘间隔（条）：进程被杀时最多重传该条数 */
export const LEDGER_FLUSH_INTERVAL = 25;

/**
 * 迁移槽（持久化形态）
 *
 * 平台侧只用自己那份存储 API 读写它；类型定义收敛在这里，避免三端字段漂移
 * （历史上 mobile 与 mp 的注释一致但字段曾经不同步）。
 */
export interface MigrationSlot {
  backup: BackupPayload;
  /** 用「新模式 masterKey」包装的旧 masterKey（首次迁移为 null；导入失败后写入，供重启重试） */
  wrappedOldMasterKey: Ciphertext | null;
  /** 旧模式 userId（用于解密 AAD 绑定的旧密文；standalone 为 null） */
  oldUserId: string | null;
  /** 联机迁移的旧→新文件夹 id 映射（不持久化则失败重试会重复建文件夹） */
  folderMap?: Record<string, string>;
  /** 账本：已成功导入的笔记 id */
  importedIds?: string[];
  /** 账本：已确认的确定性失败 id（密文不可解密），用于「未完成迁移」报告 */
  failedIds?: string[];
  /** 已尝试轮数；超过 MAX_MIGRATION_ATTEMPTS 后停止自动重试 */
  attempts?: number;
  /** 放弃后是否已提示过用户（避免每次解锁重复弹窗） */
  reportShown?: boolean;
}

/** 轮数门禁的判定结果 */
export interface MigrationAttemptGate {
  /** 本轮轮次（已自增） */
  attempts: number;
  /** 是否已超上限（超限则不应再跑导入，只做一次性报告） */
  exhausted: boolean;
  /** 槽内累计的确定性失败数（超限报告用） */
  failedCount: number;
}

/**
 * 开启一轮迁移尝试：自增轮次并判定是否已放弃自动重试。
 * 纯函数，不改动入参。
 */
export function openMigrationAttempt(slot: Pick<MigrationSlot, 'attempts' | 'failedIds'>): MigrationAttemptGate {
  const attempts = (slot.attempts ?? 0) + 1;
  return {
    attempts,
    exhausted: attempts > MAX_MIGRATION_ATTEMPTS,
    failedCount: (slot.failedIds ?? []).length,
  };
}

/** 新建文件夹的请求参数（平台侧转成各自 CreateFolderInput） */
export interface FolderCreateRequest {
  name: string;
  parentId: string | null;
  icon: string | null;
}

/**
 * 文件夹导入阶段：按备份顺序建文件夹，维护 旧id → 新id 映射。
 * 映射就地写入 folderMap（调用方负责落盘），失败单条跳过不影响整体。
 *
 * 注意：父文件夹必须先于子文件夹出现在备份里，否则子文件夹会落到顶层
 * （备份由 exportBackup 按层级顺序产出，此处不再排序）。
 */
export async function runFolderImport(
  folders: readonly Folder[],
  folderMap: Map<string, string>,
  createFolder: (input: FolderCreateRequest) => Promise<string>
): Promise<void> {
  for (const folder of folders) {
    if (folderMap.has(folder.id)) continue;
    const parentId = folder.parentId ? folderMap.get(folder.parentId) ?? null : null;
    try {
      const newId = await createFolder({
        name: folder.name,
        parentId,
        icon: folder.icon ?? null,
      });
      folderMap.set(folder.id, newId);
    } catch {
      /* 单条失败不影响整体迁移：子文件夹会落到顶层，可后续手动整理 */
    }
  }
}

/** 创建笔记的请求参数（平台侧转成各自 CreateNoteInput） */
export interface NoteCreateRequest {
  /** 保留原 id：服务端 POST /notes 幂等（ON CONFLICT 收敛），重试不产生重复笔记 */
  id: string;
  ciphertext: string;
  keyVersion: 1;
  isPinned: boolean;
  isFavorite: boolean;
  folderId: string | null;
}

/** 账本落盘载荷 */
export interface MigrationLedgerState {
  importedIds: string[];
  failedIds: string[];
}

/** 平台侧注入的 I/O */
export interface NoteImportDeps {
  /** 解密一条备份笔记（兼容 AAD 绑定）；失败返回 null */
  decrypt: (note: NoteRow) => Promise<string | null>;
  /** 用新 masterKey 重加密，返回新的密文信封字符串 */
  reEncrypt: (json: string) => Promise<string>;
  /** 创建笔记（联机走 API / 单机直写本地） */
  createNote: (input: NoteCreateRequest) => Promise<unknown>;
  /** 账本落盘（实现方内部吞掉异常即可，不致命） */
  persistLedger: (state: MigrationLedgerState) => Promise<void> | void;
}

export interface NoteImportOptions {
  notes: readonly NoteRow[];
  /** 旧→新文件夹 id 映射；无映射时笔记落入未分类 */
  folderMap: ReadonlyMap<string, string>;
  /** 上一轮已成功导入的 id（跳过，不重传） */
  importedIds?: readonly string[];
  /** 上一轮已确认的确定性失败 id（不再重试，只保留在报告里） */
  failedIds?: readonly string[];
  deps: NoteImportDeps;
  /** 账本落盘间隔，默认 LEDGER_FLUSH_INTERVAL */
  flushInterval?: number;
}

export interface NoteImportOutcome {
  /** 本轮成功导入数 */
  imported: number;
  /** 本轮失败数（含暂时性失败：网络 / 5xx） */
  failed: number;
  /** 槽内累计的确定性失败数（含历史轮次）——决定槽去留时必须一并考虑 */
  unresolved: number;
  /** 累计已成功导入的 id（含历史轮次） */
  importedIds: string[];
  /** 累计确定性失败的 id（含历史轮次） */
  failedIds: string[];
}

/**
 * 笔记导入阶段：逐条解密→重加密→创建，维护账本。
 *
 * 失败语义（关键）：
 * - `failed`：本轮未成功，但**可能自愈**（暂时性失败），下轮会重试
 * - `unresolved`：累计的确定性失败（密文不可解密），重试无用，只进报告
 */
export async function runNoteImport(opts: NoteImportOptions): Promise<NoteImportOutcome> {
  const { notes, folderMap, deps } = opts;
  const doneIds = new Set(opts.importedIds ?? []);
  const deterministic = new Set(opts.failedIds ?? []);
  const flushInterval = opts.flushInterval ?? LEDGER_FLUSH_INTERVAL;

  let imported = 0;
  let failed = 0;
  let sinceFlush = 0;
  /** 本轮是否有笔记成功解密（证明旧密钥正确） */
  let keyProven = false;
  /** 本轮解密失败的 id（结算延后到循环结束，见下方 keyProven 判定） */
  const decryptFailedIds: string[] = [];

  const flush = async () => {
    sinceFlush = 0;
    try {
      await deps.persistLedger({ importedIds: [...doneIds], failedIds: [...deterministic] });
    } catch {
      /* 账本落盘失败不致命：最坏情况是重试时重传最近若干条（服务端幂等收敛） */
    }
  };

  for (const note of notes) {
    // 已软删的笔记跳过（与服务端 importBackup 行为一致，不恢复回收站垃圾）
    if (note.deletedAt) continue;
    if (doneIds.has(note.id)) continue; // 上一轮已成功
    // 注意：已进 failedIds 的笔记**仍会重试**。重试只付出一次本地解密的代价
    // （解不出即 continue，不发任何网络请求），但保留了「换对密钥/修好密文后自愈」
    // 的可能；一旦成功，success 分支会把它从 failedIds 里移除。

    const json = await deps.decrypt(note);
    if (json === null) {
      failed++;
      decryptFailedIds.push(note.id);
      continue;
    }
    keyProven = true;

    try {
      await deps.createNote({
        id: note.id,
        ciphertext: await deps.reEncrypt(json),
        keyVersion: 1,
        isPinned: note.isPinned,
        isFavorite: note.isFavorite,
        folderId: note.folderId ? folderMap.get(note.folderId) ?? null : null,
      });
      imported++;
      doneIds.add(note.id);
      deterministic.delete(note.id);
      // 每 N 条落一次账本：进程被杀时最多重传 N 条（幂等，无副作用）
      if (++sinceFlush >= flushInterval) await flush();
    } catch {
      // 暂时性失败（网络 / 5xx）：不记确定性账，下轮重试
      failed++;
    }
  }

  // 结算解密失败：仅当本轮有笔记成功解密（密钥已被证实）才认定为确定性失败。
  // 若一条都没解出来，通常是旧密钥不对或尚未拿到——此时记账会让这些笔记在
  // 密钥修好后被永久跳过，永远迁不回来。
  if (keyProven) {
    for (const id of decryptFailedIds) deterministic.add(id);
  }

  // 收尾落账本：本轮成功的 id 必须持久化，否则下轮重试会重传（并可能复活
  // 用户已永久删除的笔记）
  await flush();

  return {
    imported,
    failed,
    unresolved: deterministic.size,
    importedIds: [...doneIds],
    failedIds: [...deterministic],
  };
}

/** 单机迁移：重加密后直写本地（保留 ID / folderId / deletedAt，覆盖式） */
export interface StandaloneConvertResult {
  /** 可直接交给 repo.importBackup 的笔记行 */
  notes: NoteRow[];
  /** 解密失败、被剔除的条数 */
  failed: number;
}

/**
 * 单机迁移的转换阶段：逐条解密→重加密，产出可导入的笔记行。
 * 解不出来的直接剔除（单机路径无法部分重试：clearBusinessData 是破坏性的）。
 */
export async function convertNotesForStandalone(
  notes: readonly NoteRow[],
  deps: Pick<NoteImportDeps, 'decrypt' | 'reEncrypt'>
): Promise<StandaloneConvertResult> {
  const converted: NoteRow[] = [];
  let failed = 0;
  for (const note of notes) {
    const json = await deps.decrypt(note);
    if (json === null) {
      failed++;
      continue;
    }
    converted.push({
      ...note,
      ciphertext: await deps.reEncrypt(json),
      keyVersion: 1,
    });
  }
  return { notes: converted, failed };
}

/**
 * 槽可否清除：本轮无失败 **且** 无历史未解决项。
 *
 * 只看本轮失败是危险的——剩余项全是历史确定性失败时本轮 failed=0，
 * 会把槽连同「未完成迁移报告」一起清掉，失败笔记静默丢失。
 */
export function canClearSlot(outcome: Pick<NoteImportOutcome, 'failed' | 'unresolved'>): boolean {
  return outcome.failed === 0 && outcome.unresolved === 0;
}
