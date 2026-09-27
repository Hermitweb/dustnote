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
import { compareSemver } from '@dustnote/shared';

type Channel = 'nightly' | 'canary' | 'beta' | 'stable';
type Platform = 'web' | 'desktop' | 'android' | 'ios' | 'miniprogram';

// ========== 产物清单（宿主托管目录 + 真实 SHA-256）==========

// 安装包托管目录：容器内路径，部署时把产物目录以只读方式挂载到这里
// （compose: /opt/dustnote-downloads:/app/web-dist/downloads:ro），nginx 经
// /downloads/ 前缀直接静态伺服，客户端下载全程走自有服务器，不依赖 GitHub。
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR ?? '/app/web-dist/downloads';

// 缓存校验指纹（mtimeMs + size）：同版本号覆盖产物后（重打 tag 重发）,
// hash 必须重算,否则 manifest 给出「旧 hash + 新 size」的自相矛盾清单——
// 客户端下载后校验必失败。此前只能靠重启容器清缓存,属运维暗坑。
const hashCache = new Map<string, { mtimeMs: number; size: number; hash: string }>();

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
  const stat = statSync(path);
  const cached = hashCache.get(path);
  let hash: string;
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    hash = cached.hash;
  } else {
    hash = `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
    hashCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, hash });
  }
  return {
    url: `${config.webOrigin}/downloads/${filename}`,
    hash,
    size: stat.size,
  };
}

function getStaticArtifacts() {
  return {
    desktop: {
      windows: artifactFor(`DustNote_${config.serverVersion}_x64-setup.exe`),
      windowsArm64: artifactFor(`DustNote_${config.serverVersion}_arm64-setup.exe`),
    },
    android: {
      apk: artifactFor(`DustNote_${config.serverVersion}_android.apk`),
    },
  };
}

// ========== 通道配置（实际可对接 CI 产物注册表）==========
// 审计 LIFE-024：通道版本改由环境变量配置（UPDATE_CHANNEL_<NAME>），
// 不再硬编码 0.1.0-* 占位——占位值会让误入灰度通道的设备收到「降级」提示
const CHANNEL_VERSIONS: Record<Channel, string> = {
  nightly: process.env.UPDATE_CHANNEL_NIGHTLY ?? '0.1.0-nightly.20260627',
  canary: process.env.UPDATE_CHANNEL_CANARY ?? '0.1.0-canary.1',
  beta: process.env.UPDATE_CHANNEL_BETA ?? '0.1.0-beta.1',
  stable: config.serverVersion,
};

/**
 * 灰度切流比例（0-1）。LIFE-008（2026-09-25）：默认 0——单用户自托管部署
 * 不存在灰度受众，默认 1% 意味着随机一个设备的更新提示被切到从未发布过的
 * beta 版本（'0.1.0-beta.1' 占位）；需要灰度时显式设 env。
 */
const BETA_TRAFFIC_RATIO = Math.min(1, Math.max(0, Number(process.env.BETA_TRAFFIC_RATIO ?? '0')));
// beta 通道未显式配置时不允许任何设备被切流（占位版本不可对外发布）
const BETA_CONFIGURED = Boolean(process.env.UPDATE_CHANNEL_BETA);

/**
 * 灰度流量切分：按 deviceId 哈希稳定切流到 beta
 * 实际生产中应支持多版本并存（蓝绿/金丝雀）
 */
function pickChannelForDevice(requested: Channel, deviceId: string): Channel {
  if (requested !== 'stable') return requested;
  if (!BETA_CONFIGURED) return 'stable';

  const hash = createHash('sha256').update(deviceId).digest();
  const byte = hash[0] ?? 0;
  const ratio = byte / 256;

  if (ratio < BETA_TRAFFIC_RATIO) return 'beta';
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
      changelogUrl: `https://github.com/Hermitweb/dustnote/releases/tag/v${version}`,
      // 审计 LIFE-024：mandatory 由 FORCE_UPDATE_VERSION 推导——
      // 通道版本达到强制升级线时置 true，未配置强制线则恒为 false
      mandatory:
        config.forceUpdateVersion != null && compareSemver(version, config.forceUpdateVersion) >= 0,
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
