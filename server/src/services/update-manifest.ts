/**
 * Update Manifest 服务层
 *
 * 实际生产中应从数据库或配置中心读取通道版本与产物清单
 * 当前 MVP 阶段：使用环境变量 + 静态清单
 */

import { createHash } from 'node:crypto';
import { config } from '../env.js';

type Channel = 'nightly' | 'canary' | 'beta' | 'stable';
type Platform = 'web' | 'desktop' | 'android' | 'ios' | 'miniprogram';

// ========== 占位清单（实际应从配置中心/CI 产物注册表读取）==========

const STATIC_ARTIFACTS = {
  web: {
    url: 'https://cdn.dustnote.app/web/latest/index.html',
    hash: '', // 由构建时计算
    size: 0,
  },
  desktop: {
    macos: {
      url: 'https://cdn.dustnote.app/desktop/latest/macos-universal.dmg',
      hash: '',
      size: 0,
    },
    windows: {
      url: 'https://cdn.dustnote.app/desktop/latest/windows-x64.exe',
      hash: '',
      size: 0,
    },
    linux: {
      url: 'https://cdn.dustnote.app/desktop/latest/linux-x86_64.AppImage',
      hash: '',
      size: 0,
    },
  },
  android: {
    apk: {
      url: 'https://cdn.dustnote.app/android/latest/app.apk',
      hash: '',
      size: 0,
      minSdkVersion: 28,
    },
    aab: {
      playUrl: 'https://play.google.com/store/apps/details?id=app.dustnote',
    },
  },
  ios: {
    appStoreUrl: 'https://apps.apple.com/app/dustnote/id000000000',
  },
  miniprogram: {
    // 与 miniprogram/package.json 保持一致
    version: '2.5.10',
    qrcodeUrl: 'https://cdn.dustnote.app/miniprogram/qr.png',
  },
};

// ========== 通道配置（实际可对接 CI 产物注册表）==========

const CHANNEL_VERSIONS: Record<Channel, string> = {
  nightly: '0.1.0-nightly.20260627',
  canary: '0.1.0-canary.1',
  beta: '0.1.0-beta.1',
  stable: config.serverVersion,
};

/**
 * 灰度流量切分：1% 切到 beta（示例）
 * 实际生产中应支持多版本并存（蓝绿/金丝雀）
 */
function pickChannelForDevice(requested: Channel, deviceId: string): Channel {
  if (requested !== 'stable') return requested;

  const hash = createHash('sha256').update(deviceId).digest();
  const byte = hash[0] ?? 0;
  const ratio = byte / 256;

  if (ratio < 0.01) return 'beta'; // 1% 灰度
  return 'stable';
}

export function getManifestForChannel(
  requestedChannel: Channel,
  client: { clientVersion: string; platform: Platform; deviceId: string }
) {
  const effectiveChannel = pickChannelForDevice(requestedChannel, client.deviceId);
  const version = CHANNEL_VERSIONS[effectiveChannel];
  const releaseDate = new Date().toISOString();

  return {
    serverVersion: config.serverVersion,
    channel: effectiveChannel,
    latest: {
      version,
      releaseDate,
      changelogUrl: `https://dustnote.app/changelog#${version}`,
      mandatory: false,
      // v2.0.0 引入单机/联机双模式架构，旧版客户端（0.x）无法连接
      minServerVersion: config.serverVersion,
      artifacts: STATIC_ARTIFACTS,
    },
    minClientVersion: config.minClientVersion,
    recommendedClientVersion: config.recommendedClientVersion,
    forceUpdateVersion: config.forceUpdateVersion,
    eolDate: config.eolDateForV0,
    maintenance: null,
  };
}
