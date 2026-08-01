/**
 * 客户端版本校验中间件
 * 详见 update-strategy.md §2、§3
 *
 * 行为：
 * 1. 读 X-Client-Version, X-Client-Platform, X-Client-Channel, X-Client-Device-Id
 * 2. 校验 SemVer 格式
 * 3. 低于 MIN_CLIENT_VERSION 或低于 FORCE_UPDATE_VERSION → 返 410
 * 4. 否则在响应头中注入 X-Force-Update-Version / X-Min-Client-Version / X-Recommended-Client-Version
 */

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { config } from '../env.js';
import { parseSemver, compareSemver } from '@dustnote/shared';
import { logger } from '../logger.js';

const ClientHeadersSchema = z.object({
  version: z.string().min(1).max(64),
  platform: z.enum(['web', 'desktop', 'android', 'ios', 'miniprogram']),
  channel: z.enum(['nightly', 'canary', 'beta', 'stable']).default('stable'),
  deviceId: z.string().min(8).max(128),
});

export function versionCheckMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 健康检查、update-manifest、auth 公开端点跳过
  // 注意：req.path 在 app.use('/api/v1', ...) 中是相对路径
  const p = req.path;
  if (
    p === '/health' ||
    p === '/update-manifest' ||
    p === '/auth/status' ||
    p === '/auth/setup' ||
    p === '/auth/unlock' ||
    p === '/auth/refresh' ||
    p === '/auth/recover' ||
    p === '/auth/recovery-params' ||
    p.startsWith('/share/public/')
  ) {
    return next();
  }

  const raw = {
    version: req.header('X-Client-Version'),
    platform: req.header('X-Client-Platform'),
    channel: req.header('X-Client-Channel'),
    deviceId: req.header('X-Client-Device-Id'),
  };

  const parsed = ClientHeadersSchema.safeParse(raw);
  if (!parsed.success) {
    res.status(400).json({
      error: 'missing_client_headers',
      message:
        '请求必须带 X-Client-Version / X-Client-Platform / X-Client-Channel / X-Client-Device-Id',
    });
    return;
  }

  // 注入响应头：所有响应都带这三个版本头
  res.setHeader('X-Min-Client-Version', config.minClientVersion);
  res.setHeader('X-Recommended-Client-Version', config.recommendedClientVersion);
  if (config.forceUpdateVersion) {
    res.setHeader('X-Force-Update-Version', config.forceUpdateVersion);
  }
  res.setHeader('X-Server-Version', config.serverVersion);

  // 强制升级检查
  const current = parseSemver(parsed.data.version);
  if (!current) {
    res.status(400).json({ error: 'invalid_client_version' });
    return;
  }

  if (
    config.forceUpdateVersion &&
    compareSemver(parsed.data.version, config.forceUpdateVersion) < 0
  ) {
    logger.warn(
      { clientVersion: parsed.data.version, platform: parsed.data.platform },
      '强制升级（L0）：客户端版本过低'
    );
    res.status(410).json({
      error: 'client_version_eol',
      message: '当前版本存在严重问题，请立即升级',
      forceUpdateVersion: config.forceUpdateVersion,
      updateUrl: 'https://dustnote.app/download',
    });
    return;
  }

  if (compareSemver(parsed.data.version, config.minClientVersion) < 0) {
    logger.warn(
      { clientVersion: parsed.data.version, min: config.minClientVersion },
      '强制升级（L1）：客户端版本低于最低支持'
    );
    res.status(410).json({
      error: 'client_version_eol',
      message: '当前版本已停止支持，请升级后继续使用',
      forceUpdateVersion: config.minClientVersion,
      updateUrl: 'https://dustnote.app/download',
    });
    return;
  }

  // 将解析后的客户端信息挂到 req 上供下游使用
  (req as Request & { client: z.infer<typeof ClientHeadersSchema> }).client = parsed.data;
  next();
}
