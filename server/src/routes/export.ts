/**
 * 导入 / 导出 API
 *
 * 导出：服务端把密文打成 JSON/MD/HTML 各种格式
 * 导入：客户端上传 .txt / .md / .docx，服务端只做格式检测不解析（解析在客户端做）
 *
 * 由于密文模型，导出实际是把单条笔记的密文 + 必要的元数据打包
 * "明文导出"只能由客户端先解密再用客户端能力
 */

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import type { AuthUser } from '../middleware/auth.js';
import { logger } from '../logger.js';

export const exportRouter = Router();

const ExportQuerySchema = z.object({
  format: z.enum(['json', 'md', 'html']).default('json'),
});

/** 导出单条笔记（密文格式 + 元数据） */
exportRouter.get('/export/notes/:id', (req, res) => {
  const user = req.user as AuthUser;
  const id = req.params.id;
  // id 参与 Content-Disposition 文件名拼接，必须校验为 UUID，
  // 防止 %22/%0d%0a 等 URL 编码字符破坏响应头格式 / 触发 setHeader 500
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const parsed = ExportQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_query' });
    return;
  }

  const db = getDb();
  const note = db
    .prepare(
      `
    SELECT id, ciphertext, key_version, is_pinned, is_favorite, version,
           client_updated_at, server_updated_at
    FROM notes WHERE id = ? AND user_id = ?
  `
    )
    .get(id, user.userId) as
    | {
        id: string;
        ciphertext: string;
        key_version: number;
        is_pinned: number;
        is_favorite: number;
        version: number;
        client_updated_at: string;
        server_updated_at: string;
      }
    | undefined;
  if (!note) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  if (parsed.data.format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="dustnote-${id}.json"`);
    res.send(
      JSON.stringify(
        {
          format: 'dustnote.v1',
          note: {
            id: note.id,
            ciphertext: JSON.parse(note.ciphertext) as unknown,
            keyVersion: note.key_version,
            isPinned: !!note.is_pinned,
            isFavorite: !!note.is_favorite,
            version: note.version,
            clientUpdatedAt: note.client_updated_at,
            serverUpdatedAt: note.server_updated_at,
          },
        },
        null,
        2
      )
    );
    return;
  }

  // md / html 格式：客户端解密后用客户端能力导出
  // 此处返回提示信息
  res.status(501).json({
    error: 'unsupported_format',
    message: 'md/html 导出需在客户端解密后使用客户端能力，服务端仅支持加密 json 备份',
  });
});

/** 全量备份：所有笔记密文打包 */
exportRouter.get('/export/backup', (req, res) => {
  const user = req.user as AuthUser;
  const db = getDb();
  const notes = db
    .prepare(
      `
    SELECT id, ciphertext, key_version, is_pinned, is_favorite, deleted_at, version,
           client_updated_at, server_updated_at, folder_id
    FROM notes WHERE user_id = ?
    ORDER BY server_updated_at
  `
    )
    .all(user.userId) as {
    id: string;
    ciphertext: string;
    key_version: number;
    is_pinned: number;
    is_favorite: number;
    deleted_at: string | null;
    version: number;
    client_updated_at: string;
    server_updated_at: string;
    folder_id: string | null;
  }[];

  const folders = db
    .prepare(`SELECT id, name, parent_id, icon FROM folders WHERE user_id = ?`)
    .all(user.userId) as {
    id: string;
    name: string;
    parent_id: string | null;
    icon: string | null;
  }[];

  const tags = db
    .prepare(`SELECT id, name, color FROM tags WHERE user_id = ?`)
    .all(user.userId) as { id: string; name: string; color: string | null }[];

  const payload = {
    format: 'dustnote-backup.v1',
    exportedAt: new Date().toISOString(),
    user: { id: user.userId },
    folders: folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id, icon: f.icon })),
    tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    notes: notes.map((n) => ({
      id: n.id,
      ciphertext: JSON.parse(n.ciphertext) as unknown,
      keyVersion: n.key_version,
      isPinned: !!n.is_pinned,
      isFavorite: !!n.is_favorite,
      deletedAt: n.deleted_at,
      version: n.version,
      clientUpdatedAt: n.client_updated_at,
      serverUpdatedAt: n.server_updated_at,
      folderId: n.folder_id,
    })),
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="dustnote-backup-${new Date().toISOString().slice(0, 10)}.json"`
  );
  res.send(JSON.stringify(payload, null, 2));

  logger.info({ userId: user.userId, noteCount: notes.length }, '全量备份已导出');
});
