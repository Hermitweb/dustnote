/**
 * 文件夹 API（明文，不加密）
 * 文件夹名不敏感，可让服务端可见以便全文搜索优化
 * 但仍支持"隐藏模式"——客户端可把文件夹名加密后存
 *
 * 目录结构范式（见 docs/note-system-folder-structure-spec.md）：
 * - 最大层级深度 2（Root 虚拟 0 → 一级=1 → 二级=2），禁止四级+（代码层拦截）
 * - 顶层二元隔离：顶层文件夹必属 'work'(业务·项目) 或 'personal'(个人·沉淀) 分支；
 *   子文件夹继承父分支，不可单独改。
 *
 * handler 导出为具名函数，便于数据层单测直接调用（无需 supertest）。
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import type { AuthUser } from '../middleware/auth.js';

export const foldersRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 分支类型：业务·项目 / 个人·沉淀 */
const BranchSchema = z.enum(['work', 'personal']).optional();

const FolderSchema = z.object({
  name: z.string().min(1).max(64),
  parentId: z.string().nullable().optional(),
  icon: z.string().max(16).optional(),
  branch: BranchSchema,
});

/** 文件夹最大嵌套深度（一级=1，二级=2，禁止三级文件夹） */
export const MAX_FOLDER_DEPTH = 2;

type Db = ReturnType<typeof getDb>;

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  icon: string | null;
  sort_order: number;
  depth: number;
  branch: string | null;
  created_at: string;
}

/** 读取单个文件夹（含 depth / branch） */
export function getFolderRow(db: Db, id: string, userId: string): FolderRow | undefined {
  return db
    .prepare(
      `SELECT id, name, parent_id, icon, sort_order, depth, branch, created_at
       FROM folders WHERE id = ? AND user_id = ?`
    )
    .get(id, userId) as FolderRow | undefined;
}

/** 收集某文件夹的全部后代 id（不含自身），用于级联删除 */
export function collectDescendantIds(db: Db, rootId: string, userId: string): string[] {
  const result: string[] = [];
  const stack = [rootId];
  const visited = new Set<string>();
  while (stack.length) {
    const cur = stack.pop() as string;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const children = db
      .prepare('SELECT id FROM folders WHERE user_id = ? AND parent_id = ?')
      .all(userId, cur) as { id: string }[];
    for (const c of children) {
      result.push(c.id);
      stack.push(c.id);
    }
  }
  return result;
}

/** 派生新文件夹的 depth 与 branch（纯逻辑，便于测试） */
export function resolveFolderMeta(
  parent: { depth: number; branch: string | null } | undefined,
  requestedBranch: 'work' | 'personal' | undefined
): { depth: number; branch: string | null } {
  if (parent) {
    return { depth: parent.depth + 1, branch: parent.branch };
  }
  return { depth: 1, branch: requestedBranch ?? null };
}

export function listFolders(req: Request, res: Response): void {
  const user = req.user as AuthUser;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, parent_id, icon, sort_order, depth, branch, created_at
       FROM folders WHERE user_id = ? ORDER BY sort_order, created_at`
    )
    .all(user.userId) as FolderRow[];
  res.json({
    folders: rows.map((r) => ({
      id: r.id,
      name: r.name,
      parentId: r.parent_id,
      icon: r.icon,
      sortOrder: r.sort_order,
      depth: r.depth,
      branch: r.branch,
      createdAt: r.created_at,
    })),
  });
}

export function createFolder(req: Request, res: Response): void {
  const user = req.user as AuthUser;
  const parsed = FolderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const db = getDb();
  const parentId = parsed.data.parentId ?? null;

  // 校验父文件夹存在且属于当前用户
  let parent: FolderRow | undefined;
  if (parentId) {
    parent = getFolderRow(db, parentId, user.userId);
    if (!parent) {
      res.status(400).json({ error: 'parent_not_found' });
      return;
    }
  }

  // 深度 + 分支（顶层二元隔离 / 子级继承）
  const meta = resolveFolderMeta(
    parent ? { depth: parent.depth, branch: parent.branch } : undefined,
    parsed.data.branch
  );
  if (meta.depth > MAX_FOLDER_DEPTH) {
    res.status(400).json({ error: 'folder_depth_exceeded' });
    return;
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO folders (id, user_id, name, parent_id, icon, depth, branch)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.userId,
    parsed.data.name,
    parentId,
    parsed.data.icon ?? null,
    meta.depth,
    meta.branch
  );
  res.status(201).json({ id });
}

export function updateFolder(req: Request, res: Response): void {
  const user = req.user as AuthUser;
  const id = req.params.id;
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }
  const parsed = FolderSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const db = getDb();
  const existing = getFolderRow(db, id, user.userId);
  if (!existing) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (parsed.data.name !== undefined) {
    updates.push('name = ?');
    params.push(parsed.data.name);
  }
  if (parsed.data.icon !== undefined) {
    updates.push('icon = ?');
    params.push(parsed.data.icon);
  }

  // 父文件夹变更：重校验深度 + 继承分支 + 防环
  if (parsed.data.parentId !== undefined) {
    const newParentId = parsed.data.parentId;
    let newDepth = 1;
    let newBranch: string | null = existing.branch;
    if (newParentId) {
      if (newParentId === id) {
        res.status(400).json({ error: 'parent_is_self' });
        return;
      }
      const parent = getFolderRow(db, newParentId, user.userId);
      if (!parent) {
        res.status(400).json({ error: 'parent_not_found' });
        return;
      }
      if (collectDescendantIds(db, id, user.userId).includes(newParentId)) {
        res.status(400).json({ error: 'parent_is_descendant' });
        return;
      }
      newDepth = parent.depth + 1;
      newBranch = parent.branch;
    } else {
      newBranch = parsed.data.branch ?? existing.branch ?? null;
    }
    if (newDepth > MAX_FOLDER_DEPTH) {
      res.status(400).json({ error: 'folder_depth_exceeded' });
      return;
    }
    updates.push('parent_id = ?');
    params.push(newParentId);
    updates.push('depth = ?');
    params.push(newDepth);
    updates.push('branch = ?');
    params.push(newBranch);
  } else if (parsed.data.branch !== undefined && existing.parent_id === null) {
    updates.push('branch = ?');
    params.push(parsed.data.branch);
  }

  if (updates.length === 0) {
    res.json({ ok: true });
    return;
  }
  params.push(id, user.userId);
  const r = db
    .prepare(`UPDATE folders SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
    .run(...params);
  if (r.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ ok: true });
}

export function deleteFolder(req: Request, res: Response): void {
  const user = req.user as AuthUser;
  const id = req.params.id;
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }
  const db = getDb();
  const existing = getFolderRow(db, id, user.userId);
  if (!existing) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  // 级联删除：先收集后代，再统一清理，避免父被删后子 folder.parent_id
  // 因 FK ON DELETE SET NULL 悬空变成顶层（丢失分支与层级语义）。
  const descendants = collectDescendantIds(db, id, user.userId);
  const allIds = [id, ...descendants];

  const r = db.transaction(() => {
    db.prepare(
      `UPDATE notes SET folder_id = NULL WHERE user_id = ? AND folder_id IN (${allIds
        .map(() => '?')
        .join(',')})`
    ).run(user.userId, ...allIds);
    for (const did of descendants) {
      db.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?').run(did, user.userId);
    }
    return db.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?').run(id, user.userId);
  })();

  if (r.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ ok: true });
}

foldersRouter.get('/folders', listFolders);
foldersRouter.post('/folders', createFolder);
foldersRouter.patch('/folders/:id', updateFolder);
foldersRouter.delete('/folders/:id', deleteFolder);
