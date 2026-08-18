/**
 * 设备管理 API
 *
 * GET    /api/v1/devices       - 列出当前用户所有登录设备/会话
 * DELETE /api/v1/devices/:id   - 吊销指定设备（清 refresh_token_hash）
 * DELETE /api/v1/devices       - 吊销除当前设备外的所有设备（"登出其他设备"）
 *
 * GDPR Article 17 / production-checklist.md §5 "设备管理"：
 * 用户必须能查看与吊销已登录设备，被盗号后可自救。
 * 注意：吊销不会踢掉当前 access token（短时效，自然过期），
 * 只阻止该设备的 refresh token 续签 access token。
 */

import { Router } from 'express';
import { getDb } from '../db.js';
import { logger } from '../logger.js';
import type { AuthUser } from '../middleware/auth.js';
import { ipHash } from '../auth/ip-hash.js';

export const devicesRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DeviceRow {
  id: string;
  user_id: string;
  name: string;
  platform: string;
  fingerprint: string;
  refresh_token_hash: string | null;
  last_active_at: string;
  created_at: string;
}

/** 当前会话是否属于该设备（用于"登出其他设备"排除自身） */
function isCurrentDevice(row: DeviceRow, user: AuthUser): boolean {
  return row.id === user.deviceId;
}

/** 列出当前用户所有设备 */
devicesRouter.get('/devices', (req, res) => {
  const user = req.user as AuthUser;
  const db = getDb();
  const rows = db
    .prepare<unknown[], DeviceRow>(
      `SELECT id, user_id, name, platform, fingerprint, refresh_token_hash, last_active_at, created_at
         FROM devices
        WHERE user_id = ?
        ORDER BY last_active_at DESC`,
    )
    .all(user.userId);

  res.json({
    devices: rows.map((r) => ({
      id: r.id,
      name: r.name,
      platform: r.platform,
      // fingerprint 只返回末 4 位，避免泄露完整指纹（用于用户辨识"这是不是我"）
      fingerprintSuffix: r.fingerprint.slice(-4),
      isCurrent: isCurrentDevice(r, user),
      hasRefreshToken: r.refresh_token_hash !== null,
      lastActiveAt: r.last_active_at,
      createdAt: r.created_at,
    })),
  });
});

/** 吊销指定设备（清 refresh_token_hash，使其无法续签 access token） */
devicesRouter.delete('/devices/:id', (req, res) => {
  const user = req.user as AuthUser;
  const deviceId = req.params.id;
  if (!deviceId || !UUID_RE.test(deviceId)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const db = getDb();

  const row = db
    .prepare<unknown[], DeviceRow>(`SELECT * FROM devices WHERE id = ? AND user_id = ?`)
    .get(deviceId, user.userId);

  if (!row) {
    res.status(404).json({ error: 'device_not_found', message: '设备不存在或不属于当前用户' });
    return;
  }

  if (isCurrentDevice(row, user)) {
    res.status(400).json({
      error: 'cannot_revoke_current_device',
      message: '不能吊销当前设备，请使用登出功能',
    });
    return;
  }

  // 清空 refresh_token_hash，该设备将无法刷新 token
  // 不直接 DELETE 行：保留审计记录（last_active_at 等）
  // WHERE 同时带 user_id 做纵深防御：即便上层 SELECT 之外有并发变更，也不会误改他用户设备
  db.prepare(`UPDATE devices SET refresh_token_hash = NULL WHERE id = ? AND user_id = ?`).run(
    deviceId,
    user.userId,
  );
  // 审计：设备吊销（安全敏感操作，被盗号后自救的关键动作，取证需可追溯）
  db.prepare(
    'INSERT INTO audit_log (user_id, device_id, event, ip_hash, meta) VALUES (?, ?, ?, ?, ?)'
  ).run(
    user.userId,
    user.deviceId,
    'device_revoke',
    ipHash(req),
    JSON.stringify({ revokedDeviceId: deviceId })
  );
  logger.info({ userId: user.userId, deviceId }, '设备已吊销');
  res.json({ ok: true });
});

/** 吊销除当前设备外的所有设备（"登出其他设备"快捷操作） */
devicesRouter.delete('/devices', (req, res) => {
  const user = req.user as AuthUser;
  const db = getDb();

  const result = db
    .prepare(
      `UPDATE devices
          SET refresh_token_hash = NULL
        WHERE user_id = ? AND id != ? AND refresh_token_hash IS NOT NULL`,
    )
    .run(user.userId, user.deviceId);

  // 审计：批量吊销其他设备
  db.prepare(
    'INSERT INTO audit_log (user_id, device_id, event, ip_hash, meta) VALUES (?, ?, ?, ?, ?)'
  ).run(
    user.userId,
    user.deviceId,
    'device_revoke_others',
    ipHash(req),
    JSON.stringify({ revokedCount: result.changes }),
  );
  logger.info(
    { userId: user.userId, revokedCount: result.changes },
    '批量吊销其他设备完成',
  );
  res.json({ ok: true, revokedCount: result.changes });
});
