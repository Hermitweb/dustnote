/**
 * 客户端更新检测：types + check 函数
 * 详见 docs/.trae/update-strategy.md §3
 */

import { z } from 'zod';
import { ForceUpdateLevel, shouldForceUpdate, ForceUpdateParams } from './version.js';

// ========== Zod Schemas（运行时校验）==========

export const ClientPlatformSchema = z.enum(['web', 'desktop', 'android', 'ios', 'miniprogram']);
export const ClientChannelSchema = z.enum(['nightly', 'canary', 'beta', 'stable']);

export const UpdateManifestArtifactSchema = z.object({
  url: z.string().url(),
  hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
  signature: z.string().optional(),
});

export const DesktopArtifactSchema = z
  .object({
    macos: UpdateManifestArtifactSchema.optional(),
    windows: UpdateManifestArtifactSchema.optional(),
    windowsArm64: UpdateManifestArtifactSchema.optional(),
    linux: UpdateManifestArtifactSchema.optional(),
  })
  .optional();

export const AndroidArtifactSchema = z
  .object({
    apk: UpdateManifestArtifactSchema.optional(),
    aab: z
      .object({
        playUrl: z.string().url(),
      })
      .optional(),
  })
  .optional();

export const IosArtifactSchema = z
  .object({
    appStoreUrl: z.string().url(),
    minOsVersion: z.string().optional(),
  })
  .optional();

export const MiniprogramArtifactSchema = z
  .object({
    version: z.string(),
    qrcodeUrl: z.string().url().optional(),
  })
  .optional();

export const UpdateManifestLatestSchema = z.object({
  version: z.string(),
  releaseDate: z.string(),
  changelogUrl: z.string().url().optional(),
  mandatory: z.boolean().default(false),
  minServerVersion: z.string().optional(),
  artifacts: z.object({
    web: UpdateManifestArtifactSchema.optional(),
    desktop: DesktopArtifactSchema,
    android: AndroidArtifactSchema,
    ios: IosArtifactSchema,
    miniprogram: MiniprogramArtifactSchema,
  }),
});

export const UpdateManifestSchema = z.object({
  serverVersion: z.string(),
  channel: ClientChannelSchema,
  latest: UpdateManifestLatestSchema,
  minClientVersion: z.string(),
  recommendedClientVersion: z.string(),
  forceUpdateVersion: z.string().nullable(),
  eolDate: z.string().optional(),
  maintenance: z
    .object({
      window: z.string(),
      impact: z.string(),
    })
    .nullable()
    .optional(),
});

// ========== 类型推导 ==========

export type ClientPlatform = z.infer<typeof ClientPlatformSchema>;
export type ClientChannel = z.infer<typeof ClientChannelSchema>;
export type UpdateManifestArtifact = z.infer<typeof UpdateManifestArtifactSchema>;
export type UpdateManifestLatest = z.infer<typeof UpdateManifestLatestSchema>;
export type UpdateManifest = z.infer<typeof UpdateManifestSchema>;

// ========== 客户端检测 ==========

export interface CheckUpdateOptions {
  /** 当前版本 */
  currentVersion: string;
  /** 平台 */
  platform: ClientPlatform;
  /** 通道 */
  channel: ClientChannel;
  /** 设备 ID（用于灰度） */
  deviceId: string;
  /** API base URL（默认 /api/v1） */
  apiBase?: string;
  /** fetch 实现（默认 globalThis.fetch） */
  fetcher?: typeof fetch;
  /** 自定义 X-* 头 */
  extraHeaders?: Record<string, string>;
  /** 取消信号（用于组件卸载 / StrictMode 双调用） */
  signal?: AbortSignal;
}

export interface CheckUpdateResult {
  status: 'ok' | 'force_update' | 'maintenance' | 'error';
  manifest?: UpdateManifest | undefined;
  forceLevel?: ForceUpdateLevel | undefined;
  updateUrl?: string | undefined;
  message?: string | undefined;
  /** 是否有可用更新（包括 soft_prompt） */
  hasUpdate?: boolean | undefined;
}

/** 主入口：调用 update-manifest API 并做强制升级判断 */
export async function checkForUpdate(opts: CheckUpdateOptions): Promise<CheckUpdateResult> {
  const apiBase = opts.apiBase ?? '/api/v1';
  const url = `${apiBase}/update-manifest`;
  const fetcher = opts.fetcher ?? globalThis.fetch;

  const headers: Record<string, string> = {
    'X-Client-Version': opts.currentVersion,
    'X-Client-Platform': opts.platform,
    'X-Client-Channel': opts.channel,
    'X-Client-Device-Id': opts.deviceId,
    ...opts.extraHeaders,
  };

  try {
    const res = await fetcher(url, {
      headers,
      method: 'GET',
      ...(opts.signal ? { signal: opts.signal } : {}),
    });

    if (res.status === 410) {
      const body = (await res.json().catch(() => ({}))) as {
        forceUpdateVersion?: string;
        updateUrl?: string;
      };
      return {
        status: 'force_update',
        forceLevel: 'L0_block',
        updateUrl: body.updateUrl,
        message: '当前版本已停止支持，请升级后继续使用',
      };
    }

    if (res.status === 503) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return { status: 'maintenance', message: body.message ?? '服务维护中' };
    }

    if (!res.ok) {
      return { status: 'error', message: `HTTP ${res.status}` };
    }

    const data = (await res.json()) as unknown;
    const parsed = UpdateManifestSchema.safeParse(data);
    if (!parsed.success) {
      return { status: 'error', message: 'Invalid manifest' };
    }
    const manifest = parsed.data;

    // 强制升级判断
    const params: ForceUpdateParams = {
      current: opts.currentVersion,
      min: manifest.minClientVersion,
      recommended: manifest.recommendedClientVersion,
      force: manifest.forceUpdateVersion,
      releaseDate: manifest.latest.releaseDate,
    };
    const forceLevel = shouldForceUpdate(params);

    // 取当前平台的下载 URL
    const updateUrl = getPlatformDownloadUrl(manifest, opts.platform);

    // L0/L1/L2 需要阻断或强提示 → status=force_update
    // L3 仅软提示 → status=ok + hasUpdate=true
    const isBlocking = forceLevel === 'L0_block' || forceLevel === 'L1_2nd_startup' || forceLevel === 'L2_strong_prompt';

    return {
      status: isBlocking ? 'force_update' : 'ok',
      manifest,
      forceLevel,
      updateUrl,
      hasUpdate: forceLevel !== null && forceLevel !== undefined,
    };
  } catch (err) {
    // 主动 abort（如组件卸载 / StrictMode 双调用）不视为错误
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { status: 'ok' };
    }
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'ok' };
    }
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

/** 取平台对应的下载 URL */
export function getPlatformDownloadUrl(
  manifest: UpdateManifest,
  platform: ClientPlatform
): string | undefined {
  const a = manifest.latest.artifacts;
  switch (platform) {
    case 'web':
      return a.web?.url;
    case 'desktop': {
      // 检测当前 OS 选择对应下载链接
      if (typeof navigator !== 'undefined') {
        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes('mac')) return a.desktop?.macos?.url;
        if (ua.includes('win')) return a.desktop?.windows?.url;
        return a.desktop?.linux?.url;
      }
      return a.desktop?.macos?.url ?? a.desktop?.windows?.url ?? a.desktop?.linux?.url;
    }
    case 'android':
      return a.android?.apk?.url ?? a.android?.aab?.playUrl;
    case 'ios':
      return a.ios?.appStoreUrl;
    case 'miniprogram':
      return a.miniprogram?.qrcodeUrl;
    default:
      return undefined;
  }
}
