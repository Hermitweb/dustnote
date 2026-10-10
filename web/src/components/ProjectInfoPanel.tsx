/**
 * 项目信息面板（设置 → 关于）
 *
 * 把散落的信息聚到一处：应用/服务器版本、安全参数（KDF / 2FA）、
 * 数据统计（笔记 / 文件夹 / 回收站，来自 store 内存态，不额外解密）、
 * 开源许可与项目链接（GitHub / 隐私政策 / 服务条款 / 第三方许可）。
 *
 * 设计约束：
 * - 链接复用 AboutDialog 的 openExternalUrl 模式：Tauri 下走 opener 插件
 *   （WebView 打不开外部 HTTPS），Web 下 window.open。
 * - 服务器版本来自 /health（匿名可达、只回 version，不含业务规模）；拿不到
 *   （单机模式 / 断网）显示「未连接」而不是报错——这是信息面板，不是诊断页。
 * - 不放任何密钥材料或 userId 明细：面板可能被旁观者看到。
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import { useStore } from '../lib/store';
import { isTauri } from '../lib/platform';
import { getConfig } from '../lib/config';
import { useModeStore } from '../lib/mode-store';

const REPO_URL = 'https://github.com/Hermitweb/dustnote';

/** 打开外部 URL：Tauri 下走 opener 插件，Web 下走 window.open（AboutDialog 同款） */
async function openExternalUrl(url: string): Promise<void> {
  const openUrlFn = (window as unknown as { __dustnoteOpenUrl?: (url: string) => Promise<void> })
    .__dustnoteOpenUrl;
  if (isTauri() && openUrlFn) {
    try {
      await openUrlFn(url);
      return;
    } catch {
      // opener 插件失败时回退到 window.open
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** 服务端版本：/health 匿名可达且带 version 字段（不含业务规模，审计 SEC-014）。
 *  与设置面板 serverUrl 口径一致（mode-store；Tauri 桌面端必须用绝对地址）。
 *  探测失败（单机 / 断网）返回 null——信息面板不报错。 */
async function fetchServerVersion(): Promise<string | null> {
  try {
    const { serverUrl } = useModeStore.getState();
    const apiV1 = getConfig().apiBase.replace(/\/+$/, ''); // 形如 /api/v1（loadConfig 在应用启动时已加载）
    const healthUrl = serverUrl
      ? `${serverUrl.replace(/\/+$/, '')}${apiV1}/health`
      : `${window.location.origin}${apiV1}/health`;
    const res = await fetch(healthUrl, { method: 'GET', credentials: 'omit' });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/** KDF 参数的人类可读格式：PBKDF2-SHA256 · 100000 轮 / Argon2id · m=… t=… p=… */
function formatKdf(
  params: { algorithm?: string; iterations?: number; m?: number; t?: number; p?: number } | null
): string {
  if (!params) return 'PBKDF2-SHA256';
  if (params.algorithm === 'argon2id') {
    return `Argon2id · m=${params.m ?? '?'} t=${params.t ?? '?'} p=${params.p ?? '?'}`;
  }
  return params.iterations
    ? `PBKDF2-SHA256 · ${params.iterations.toLocaleString()}`
    : 'PBKDF2-SHA256';
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0">{label}</span>
      <span className="truncate text-right font-mono text-surface-fg">{value}</span>
    </div>
  );
}

export function ProjectInfoPanel() {
  const { t } = useTranslation();
  const appMode = useStore((s) => s.mode);
  const notes = useStore((s) => s.notes);
  const folders = useStore((s) => s.folders);
  const totpEnabled = useStore((s) => s.totpEnabled);
  const accountKdfParams = useStore((s) => s.accountKdfParams);
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  useEffect(() => {
    if (appMode !== 'online') return;
    let cancelled = false;
    void fetchServerVersion().then((v) => {
      if (!cancelled) setServerVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, [appMode]);

  const noteRows = Array.from(notes.values());
  const activeCount = noteRows.filter((n) => !n.deletedAt).length;
  const trashedCount = noteRows.length - activeCount;

  return (
    <div className="rounded-lg border border-surface-border p-3 text-xs text-surface-muted">
      <div className="mb-2 font-semibold text-surface-fg">{t('settings.project_info')}</div>

      {/* 版本信息 */}
      <div className="space-y-1">
        <InfoRow label={t('settings.project_info_version')} value={__APP_VERSION__} />
        {appMode === 'online' && (
          <InfoRow
            label={t('settings.project_info_server_version')}
            value={serverVersion ?? t('settings.project_info_server_unreachable')}
          />
        )}
        {appMode === 'standalone' && (
          <div className="text-surface-muted">{t('settings.project_info_standalone_hint')}</div>
        )}
      </div>

      {/* 安全参数 */}
      <div className="mt-2 space-y-1 border-t border-surface-border pt-2">
        <InfoRow label={t('settings.project_info_kdf')} value={formatKdf(accountKdfParams)} />
        <InfoRow
          label={t('settings.project_info_2fa')}
          value={
            <span className={totpEnabled ? 'text-success' : ''}>
              {totpEnabled ? t('settings.project_info_2fa_on') : t('settings.project_info_2fa_off')}
            </span>
          }
        />
      </div>

      {/* 数据统计（内存态计数，不解密任何内容） */}
      <div className="mt-2 space-y-1 border-t border-surface-border pt-2">
        <div className="font-semibold text-surface-fg">{t('settings.project_info_stats')}</div>
        <InfoRow label={t('settings.project_info_notes')} value={activeCount} />
        <InfoRow label={t('settings.project_info_folders')} value={folders.length} />
        <InfoRow label={t('settings.project_info_trashed')} value={trashedCount} />
      </div>

      {/* 开源许可 */}
      <div className="mt-2 space-y-1 border-t border-surface-border pt-2">
        <InfoRow
          label={t('settings.project_info_license')}
          value={t('settings.project_info_license_line')}
        />
      </div>

      {/* 项目链接 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-surface-border pt-2">
        <button
          type="button"
          onClick={() => void openExternalUrl(REPO_URL)}
          className="cursor-pointer underline hover:text-surface-fg"
        >
          <Icon name="language" size={14} className="mr-1 inline-block align-[-2px]" />
          {t('settings.project_info_repo')}
        </button>
        <button
          type="button"
          onClick={() => void openExternalUrl(`${REPO_URL}/blob/main/docs/privacy-policy.md`)}
          className="cursor-pointer underline hover:text-surface-fg"
        >
          {t('settings.project_info_privacy')}
        </button>
        <button
          type="button"
          onClick={() => void openExternalUrl(`${REPO_URL}/blob/main/docs/terms-of-service.md`)}
          className="cursor-pointer underline hover:text-surface-fg"
        >
          {t('settings.project_info_terms')}
        </button>
        <button
          type="button"
          onClick={() => void openExternalUrl(`${REPO_URL}/blob/main/THIRD_PARTY_NOTICES.md`)}
          className="cursor-pointer underline hover:text-surface-fg"
        >
          {t('settings.project_info_notices')}
        </button>
      </div>
    </div>
  );
}
