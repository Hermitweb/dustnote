/**
 * Update Manifest 服务层
 *
 * 实际生产中应从数据库或配置中心读取通道版本与产物清单
 * 当前 MVP 阶段：使用环境变量 + 静态清单
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../env.js';

type Channel = 'nightly' | 'canary' | 'beta' | 'stable';
type Platform = 'web' | 'desktop' | 'android' | 'ios' | 'miniprogram';

// ========== 产物清单（宿主托管目录 + 真实 SHA-256）==========

// 安装包托管目录：容器内路径，部署时把产物目录以只读方式挂载到这里
// （compose: /opt/dustnote-downloads:/app/web-dist/downloads:ro），nginx 经
// /downloads/ 前缀直接静态伺服，客户端下载全程走自有服务器，不依赖 GitHub。
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR ?? '/app/web-dist/downloads';

const hashCache = new Map<string, string>();

/**
 * 按文件名构建 artifact。
 * 客户端 UpdateManifestArtifactSchema 严格校验 hash 必须是
 * `sha256:<64位hex>`——空串占位会让整个 manifest 校验失败
 * （安卓端曾因此报 "Invalid manifest"）。因此这里对存在的文件
 * 计算真实 SHA-256（结果缓存）；文件缺失时返回 undefined——schema
 * 中各 artifact 均为 optional，省略优于输出非法值。
 */
function artifactFor(filename: string): { url: string; hash: string; size: number } | undefined {
  const path = join(DOWNLOADS_DIR, filename);
  if (!existsSync(path)) return undefined;
  let hash = hashCache.get(path);
  if (!hash) {
    hash = `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
    hashCache.set(path, hash);
  }
  return {
    url: `${config.webOrigin}/downloads/${filename}`,
    hash,
    size: statSync(path).size,
  };
}

function getStaticArtifacts() {
  return {
    desktop: {
      windows: artifactFor(`DustNote_${config.serverVersion}_x64-setup-nsis.exe`),
    },
    android: {
      apk: artifactFor(`DustNote_${config.serverVersion}_android.apk`),
    },
  };
}

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
      artifacts: getStaticArtifacts(),
    },
    minClientVersion: config.minClientVersion,
    recommendedClientVersion: config.recommendedClientVersion,
    forceUpdateVersion: config.forceUpdateVersion,
    eolDate: config.eolDateForV0,
    maintenance: null,
  };
}
