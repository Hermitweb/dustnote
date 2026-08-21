/**
 * 字段级冲突合并器（架构改进 #3）
 *
 * 旧同步模型的问题：
 * flushQueue 拿到 409 直接丢弃 op + loadAll() 拉服务端最新 →
 * 本质是「服务端 last-write-wins」。多设备离线编辑同一篇笔记时，
 * 一方的改动会被**静默覆盖**。对笔记类应用，这是真实的数据丢失风险。
 *
 * 本模块实现三方字段级合并（base / local / server）：
 * - base  = 入队时客户端认为的「公共祖先」明文 + 元数据
 * - local = 客户端本次编辑后的明文 + 元数据
 * - server= 409 响应里服务端当前 NoteRow 解密后的明文 + 元数据
 *
 * 合并规则（每字段独立判定）：
 * - 仅一方相对 base 改动 → 取那一方（非冲突，自动应用）
 * - 双方都改动 → 记为冲突；merged 取 local（保住用户未保存的编辑），
 *   同时把 server 值放进冲突记录供 UI 展示 diff，让用户裁决
 * - tags 是数组：双方都改时 suggested=并集（标签天然可加），merged 取并集，
 *   仍记冲突让 UI 可确认/调整
 * - deletedAt：服务端删除 vs 本地编辑内容 → 记 'deletedAt' 冲突，
 *   merged 保留 local（不丢编辑），UI 提示「对端已删除，是否恢复」
 *
 * 契约：
 * - hasConflicts=false → 调用方可静默自动应用 merged（无字段歧义）
 * - hasConflicts=true  → 调用方仍可先把 merged 作为暂存态应用（不丢数据），
 *   同时把 conflicts 推到 UI 让用户复核/覆盖
 *
 * 纯逻辑、无平台依赖、无 IO —— 易测、四端共用。
 */

import type { NotePlaintext } from '@dustnote/shared';

/** 笔记元数据（与 NoteRow 的非密文字段对齐） */
export interface NoteMetadata {
  isPinned: boolean;
  isFavorite: boolean;
  /** 软删除时间，null = 未删除 */
  deletedAt: string | null;
  folderId: string | null;
  /** 客户端时间戳，用于断定哪一侧更新 */
  clientUpdatedAt: string;
}

/** 参与合并的一条笔记：明文 + 元数据 */
export interface MergeableNote extends NoteMetadata {
  id: string;
  plaintext: NotePlaintext;
}

/** 单字段冲突描述 */
export interface FieldConflict {
  field: string;
  baseValue: unknown;
  localValue: unknown;
  serverValue: unknown;
  /** 建议值（如 tags 并集），UI 可用作默认选项 */
  suggested?: unknown;
}

/** 合并结果 */
export interface ConflictResult {
  /** 最佳努力合并结果；无冲突时可直接应用，有冲突时作为暂存态 */
  merged: MergeableNote;
  /** 需要用户裁决的字段（空数组 = 无歧义） */
  conflicts: FieldConflict[];
  hasConflicts: boolean;
}

/** 标量是否变化（JSON 序列化后比较，兼容对象/数组之外的类型） */
function changed(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** 标签数组是否变化（忽略顺序，按集合比较） */
function tagsChanged(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.some((v, i) => v !== sb[i]);
}

/** 两个数组的并集（去重，保序：先 local 再补 server 中新增的） */
function unionTags(local: string[], server: string[]): string[] {
  const out = [...local];
  for (const t of server) {
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

type MetaField = 'isPinned' | 'isFavorite' | 'folderId' | 'deletedAt';

/**
 * 三方字段级合并。
 *
 * @param base   公共祖先（入队时客户端持有的版本）
 * @param local  客户端编辑后状态
 * @param server 服务端当前状态（409 current 解密后）
 */
export function resolveConflict(
  base: MergeableNote,
  local: MergeableNote,
  server: MergeableNote
): ConflictResult {
  const conflicts: FieldConflict[] = [];
  const merged: MergeableNote = {
    id: base.id,
    plaintext: { title: '', content: '', tags: [] },
    isPinned: false,
    isFavorite: false,
    deletedAt: null,
    folderId: null,
    clientUpdatedAt: local.clientUpdatedAt,
  };

  // ---- 内容字段：title / content ----
  for (const field of ['title', 'content'] as const) {
    const baseVal = base.plaintext[field];
    const localVal = local.plaintext[field];
    const serverVal = server.plaintext[field];
    const cL = changed(localVal, baseVal);
    const cS = changed(serverVal, baseVal);
    if (cL && cS && changed(localVal, serverVal)) {
      // 双方都改了且不同：保住 local 编辑，记冲突
      merged.plaintext[field] = localVal;
      conflicts.push({ field, baseValue: baseVal, localValue: localVal, serverValue: serverVal });
    } else if (cL && cS) {
      // 双方都改了但相同：达成一致，无冲突
      merged.plaintext[field] = localVal;
    } else if (cL) {
      merged.plaintext[field] = localVal;
    } else if (cS) {
      merged.plaintext[field] = serverVal;
    } else {
      merged.plaintext[field] = baseVal;
    }
  }

  // ---- tags（数组，集合语义）----
  {
    const baseVal = base.plaintext.tags;
    const localVal = local.plaintext.tags;
    const serverVal = server.plaintext.tags;
    const cL = tagsChanged(localVal, baseVal);
    const cS = tagsChanged(serverVal, baseVal);
    if (cL && cS && tagsChanged(localVal, serverVal)) {
      const suggested = unionTags(localVal, serverVal);
      merged.plaintext.tags = suggested;
      conflicts.push({
        field: 'tags',
        baseValue: baseVal,
        localValue: localVal,
        serverValue: serverVal,
        suggested,
      });
    } else if (cL && cS) {
      // 双方改成同一标签集：达成一致
      merged.plaintext.tags = localVal;
    } else if (cL) {
      merged.plaintext.tags = localVal;
    } else if (cS) {
      merged.plaintext.tags = serverVal;
    } else {
      merged.plaintext.tags = baseVal;
    }
  }

  // ---- 元数据标量字段（不含 deletedAt，后者需跨字段判定）----
  // 字段类型异构（boolean / string | null），用显式写回避免联合索引产生 never
  const metaFields: MetaField[] = ['isPinned', 'isFavorite', 'folderId'];
  for (const field of metaFields) {
    const baseVal = base[field] as boolean | string | null;
    const localVal = local[field] as boolean | string | null;
    const serverVal = server[field] as boolean | string | null;
    const cL = changed(localVal, baseVal);
    const cS = changed(serverVal, baseVal);
    let chosen: boolean | string | null;
    if (cL && cS && changed(localVal, serverVal)) {
      chosen = localVal;
      conflicts.push({ field, baseValue: baseVal, localValue: localVal, serverValue: serverVal });
    } else if (cL && cS) {
      chosen = localVal; // 达成一致
    } else if (cL) {
      chosen = localVal;
    } else if (cS) {
      chosen = serverVal;
    } else {
      chosen = baseVal;
    }
    if (field === 'isPinned') merged.isPinned = chosen as boolean;
    else if (field === 'isFavorite') merged.isFavorite = chosen as boolean;
    else merged.folderId = chosen as string | null;
  }

  // ---- deletedAt：跨字段「删除 vs 编辑」判定 ----
  // 服务端把笔记删了，本地却在编辑内容 → 不能静默接受删除（会丢本地编辑），
  // 记冲突让用户裁决；merged 保留 local.deletedAt（不删）。
  {
    const baseVal = base.deletedAt;
    const localVal = local.deletedAt;
    const serverVal = server.deletedAt;
    const cL = changed(localVal, baseVal);
    const cS = changed(serverVal, baseVal);
    const localContentChanged =
      changed(local.plaintext.title, base.plaintext.title) ||
      changed(local.plaintext.content, base.plaintext.content) ||
      tagsChanged(local.plaintext.tags, base.plaintext.tags);

    if (serverVal !== null && baseVal === null && localContentChanged) {
      // 删除 vs 编辑：保住本地编辑，不静默删除
      merged.deletedAt = localVal;
      conflicts.push({
        field: 'deletedAt',
        baseValue: baseVal,
        localValue: localVal,
        serverValue: serverVal,
      });
    } else if (cL && cS && changed(localVal, serverVal)) {
      merged.deletedAt = localVal;
      conflicts.push({
        field: 'deletedAt',
        baseValue: baseVal,
        localValue: localVal,
        serverValue: serverVal,
      });
    } else if (cL && cS) {
      merged.deletedAt = localVal; // 达成一致
    } else if (cL) {
      merged.deletedAt = localVal;
    } else if (cS) {
      merged.deletedAt = serverVal;
    } else {
      merged.deletedAt = baseVal;
    }
  }

  return {
    merged,
    conflicts,
    hasConflicts: conflicts.length > 0,
  };
}

/**
 * 从一个已解密的服务端 NoteRow 构造 MergeableNote（供 409 合并用）。
 *
 * 调用方负责解密 ciphertext 得到 plaintext 后传入。
 */
export function toMergeable(
  id: string,
  plaintext: NotePlaintext,
  meta: NoteMetadata
): MergeableNote {
  return {
    id,
    plaintext,
    isPinned: meta.isPinned,
    isFavorite: meta.isFavorite,
    deletedAt: meta.deletedAt,
    folderId: meta.folderId,
    clientUpdatedAt: meta.clientUpdatedAt,
  };
}
