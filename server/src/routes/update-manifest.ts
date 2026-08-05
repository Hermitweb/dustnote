/**
 * GET /api/v1/update-manifest
 *
 * 返回客户端更新清单，详见 update-strategy.md §3
 */

import { Router } from 'express';
import { z } from 'zod';
import { config } from '../env.js';
import { logger } from '../logger.js';
import { getManifestForChannel } from '../services/update-manifest.js';

export const updateManifestRouter = Router();

const QuerySchema = z.object({
  // 预留：未来可带 ?channel= 覆盖 header
  channel: z.enum(['nightly', 'canary', 'beta', 'stable']).optional(),
});

/** 校验 X-Client-Channel 头，非法值回退 'stable'，避免 CHANNEL_VERSIONS 取到 undefined */
function parseChannelHeader(raw: string | undefined): 'nightly' | 'canary' | 'beta' | 'stable' {
  const parsed = z.enum(['nightly', 'canary', 'beta', 'stable']).safeParse(raw);
  return parsed.success ? parsed.data : 'stable';
}

updateManifestRouter.get('/update-manifest', (req, res) => {
  const headers = {
    version: req.header('X-Client-Version'),
    platform: req.header('X-Client-Platform'),
    channel: req.header('X-Client-Channel'),
    deviceId: req.header('X-Client-Device-Id'),
  };

  if (!headers.version || !headers.platform || !headers.deviceId) {
    res.status(400).json({
      error: 'missing_client_headers',
      message: '请求必须带 X-Client-Version / X-Client-Platform / X-Client-Device-Id',
    });
    return;
  }

  const query = QuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: 'invalid_query' });
    return;
  }

  const requestedChannel =
    query.data.channel ?? parseChannelHeader(headers.channel) ?? 'stable';

  const manifest = getManifestForChannel(requestedChannel, {
    clientVersion: headers.version,
    platform: headers.platform as 'web' | 'desktop' | 'android' | 'ios' | 'miniprogram',
    deviceId: headers.deviceId,
  });

  res.setHeader('Cache-Control', 'public, max-age=300'); // 5min
  res.setHeader('X-Min-Client-Version', config.minClientVersion);
  res.setHeader('X-Recommended-Client-Version', config.recommendedClientVersion);
  if (config.forceUpdateVersion) {
    res.setHeader('X-Force-Update-Version', config.forceUpdateVersion);
  }
  res.setHeader('X-Server-Version', config.serverVersion);

  logger.debug(
    {
      deviceId: headers.deviceId.slice(0, 8),
      platform: headers.platform,
      channel: requestedChannel,
    },
    'update-manifest 返回'
  );

  res.json(manifest);
});
