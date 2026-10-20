/**
 * 部署管理页面：配置服务器 + 生成各平台免配置包
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, IconText } from './Icon';
import type { IconName } from '@dustnote/shared';
import { toast } from '../lib/toast';
import { copyText } from '../lib/clipboard';
import { ConfirmDialog } from './ConfirmDialog';
import {
  getConfig,
  saveConfig,
  generatePlatformConfig,
  downloadConfig,
  loadConfig,
  resetConfigStorage,
  CONFIG_DEFAULTS,
  type AppConfig,
} from '../lib/config';

/** apiBase 形状校验：允许相对路径（同源部署）或 http(s) 绝对地址。
 *  返回错误 key（i18n），null = 合法。 */
export function validateApiBase(v: string): string | null {
  const s = v.trim();
  if (!s) return 'admin.validate_empty';
  if (s.endsWith('/')) return 'admin.validate_trailing_slash';
  if (s.endsWith('/api/v1')) return null;
  if (/^https?:\/\//.test(s) || s.startsWith('/')) return 'admin.validate_missing_api_v1';
  return 'admin.validate_invalid_url';
}

/** 小程序 AppID 形状校验：wx + 16 位小写 hex；空串合法（未填）。 */
export function validateMpAppId(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (!/^wx[0-9a-f]{16}$/.test(s)) return 'admin.validate_appid';
  return null;
}

/** 连接测试结果状态机 */
type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; version: string }
  | { kind: 'fail'; reason: string };

type PlatformId = 'web' | 'desktop' | 'miniprogram' | 'android' | 'ios';

const PLATFORMS: {
  id: PlatformId;
  icon: IconName;
  file: string;
  nameKey: string;
  descKey: string;
}[] = [
  {
    id: 'web',
    icon: 'language',
    file: 'dustnote-web-config.json',
    nameKey: 'admin.plat_web',
    descKey: 'admin.desc_web',
  },
  {
    id: 'desktop',
    icon: 'desktop',
    file: 'dustnote-desktop-config.json',
    nameKey: 'admin.plat_desktop',
    descKey: 'admin.desc_desktop',
  },
  {
    id: 'miniprogram',
    icon: 'device',
    file: 'dustnote-miniprogram.txt',
    nameKey: 'admin.plat_miniprogram',
    descKey: 'admin.desc_miniprogram',
  },
  {
    id: 'android',
    icon: 'bot',
    file: 'dustnote-android-config.json',
    nameKey: 'admin.plat_android',
    descKey: 'admin.desc_android',
  },
  {
    id: 'ios',
    icon: 'apple',
    file: 'dustnote-ios-config.json',
    nameKey: 'admin.plat_ios',
    descKey: 'admin.desc_ios',
  },
];

export function AdminConfig({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<AppConfig>(getConfig());
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'download' | 'miniprogram'>('config');
  // 连接测试（Tab 1）：对用户填的 apiBase 探测 /health，回显服务器版本
  const [testState, setTestState] = useState<TestState>({ kind: 'idle' });
  // 预览的配置内容（Tab 2）：null = 未打开预览
  const [previewing, setPreviewing] = useState<PlatformId | null>(null);
  // 恢复默认确认（Tab 1）：重置会覆盖当前所有字段，两步确认防手滑
  const [resetConfirm, setResetConfirm] = useState(false);

  useEffect(() => {
    void loadConfig().then(setCfg);
  }, []);

  const apiBaseError = validateApiBase(cfg.apiBase);
  /** 小程序 AppID 形状校验：微信 AppID = wx + 16 位小写 hex（空 = 未填，合法） */
  const appIdError = validateMpAppId(cfg.miniprogramAppId);

  const handleSave = () => {
    // 保存前校验：格式错误直接拦下，不给「存了但所有客户端连不上」的静默故障
    const err = validateApiBase(cfg.apiBase);
    if (err) {
      toast.error(t(err));
      return;
    }
    if (appIdError) {
      toast.error(t(appIdError));
      return;
    }
    saveConfig({
      ...cfg,
      apiBase: cfg.apiBase.trim(),
      appName: cfg.appName.trim() || 'DustNote',
      miniprogramAppId: cfg.miniprogramAppId.trim(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  /** 恢复默认配置：清 localStorage 覆盖项，回落到出厂默认（CONFIG_DEFAULTS）。
   *  resetConfigStorage 同时清 cached，saveConfig 落一份干净的默认值。 */
  const handleReset = (): void => {
    resetConfigStorage();
    const fresh: AppConfig = { ...CONFIG_DEFAULTS };
    setCfg(fresh);
    saveConfig(fresh);
    setResetConfirm(false);
    setTestState({ kind: 'idle' });
    toast.success(t('admin.reset_done'));
  };

  /** 连接测试：GET <apiBase>/health（匿名可达，返回 {ok, version, db}）。
   *  超时 8s——自托管场景跨公网探测，太短会误报。 */
  const handleTestConnection = async (): Promise<void> => {
    if (apiBaseError) {
      setTestState({ kind: 'fail', reason: t(apiBaseError) });
      return;
    }
    setTestState({ kind: 'testing' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${cfg.apiBase.trim().replace(/\/+$/, '')}/health`, {
        signal: controller.signal,
        credentials: 'omit',
      });
      if (!res.ok) {
        setTestState({ kind: 'fail', reason: `HTTP ${res.status}` });
        return;
      }
      const data = (await res.json()) as { ok?: boolean; version?: string };
      if (!data.ok) {
        setTestState({ kind: 'fail', reason: t('admin.test_db_error') });
        return;
      }
      setTestState({ kind: 'ok', version: data.version ?? '' });
    } catch (e) {
      const reason =
        (e as { name?: string }).name === 'AbortError'
          ? t('settings.op_timeout', { ms: 8000 })
          : t('settings.connection_failed');
      setTestState({ kind: 'fail', reason });
    } finally {
      clearTimeout(timer);
    }
  };

  /** 复制配置内容（Tab 2）：下载与复制并存——移动端/远程桌面下载不便 */
  const handleCopyConfig = async (p: (typeof PLATFORMS)[number]): Promise<void> => {
    const ok = await copyText(generatePlatformConfig(p.id));
    if (ok) toast.success(t('admin.copy_ok', { file: p.file }));
    else toast.error(t('admin.copy_fail'));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center scrim p-4 backdrop-blur-[2px] sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[72vh] w-full max-w-3xl flex-col rounded-xl bg-surface-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-surface-border p-4">
          <h2 className="text-xl font-semibold text-text-primary">{t('admin.title')}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded p-1 text-text-tertiary transition-colors hover:bg-surface-3 hover:text-text-primary"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex border-b border-surface-border px-4">
          {(['config', 'download', 'miniprogram'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-accent-strong text-accent-text'
                  : 'border-transparent text-surface-muted hover:text-surface-fg'
              }`}
            >
              {tab === 'config' ? (
                <IconText k="admin.tab_config" label={t('admin.tab_config')} />
              ) : tab === 'download' ? (
                <IconText k="admin.tab_download" label={t('admin.tab_download')} />
              ) : (
                <IconText k="admin.tab_miniprogram" label={t('admin.tab_miniprogram')} />
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* ===== Tab 1: 配置 ===== */}
          {activeTab === 'config' && (
            <div className="space-y-5">
              <div>
                <label className="mb-1 block text-sm font-semibold text-surface-fg">
                  {t('admin.api_base')}
                </label>
                <input
                  value={cfg.apiBase}
                  onChange={(e) => {
                    setCfg((p) => ({ ...p, apiBase: e.target.value }));
                    // 输入变化后旧测试结果失效
                    setTestState({ kind: 'idle' });
                  }}
                  placeholder="https://api.your-domain.com/api/v1"
                  aria-invalid={!!apiBaseError}
                  className={`w-full rounded-lg border bg-surface-bg px-3 py-2 text-sm text-surface-fg focus:border-accent ${
                    apiBaseError ? 'border-danger' : 'border-surface-border'
                  }`}
                />
                {/* 校验反馈：有错显错误，合法且未在测试时显示测试按钮 */}
                {apiBaseError ? (
                  <p className="mt-1 text-xs text-danger">{t(apiBaseError)}</p>
                ) : (
                  <p className="mt-1 text-xs text-surface-muted">{t('admin.api_base_hint')}</p>
                )}

                {/* 连接测试行 */}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTestConnection()}
                    disabled={testState.kind === 'testing' || !!apiBaseError}
                    className="rounded border border-surface-border px-3 py-1 text-xs text-surface-fg transition-colors hover:bg-surface-bg disabled:opacity-50"
                  >
                    {testState.kind === 'testing' ? (
                      t('admin.testing')
                    ) : (
                      <IconText k="admin.test_btn" label={t('admin.test_btn')} />
                    )}
                  </button>
                  {testState.kind === 'ok' && (
                    <span className="inline-flex items-center gap-1 text-xs text-success">
                      <Icon name="check" size={14} />
                      {t('admin.test_ok', {
                        version: testState.version || t('admin.test_unknown_version'),
                      })}
                    </span>
                  )}
                  {testState.kind === 'fail' && (
                    <span className="text-xs text-danger">
                      {t('admin.test_fail', { reason: testState.reason })}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-surface-fg">
                  {t('admin.app_name')}
                </label>
                <input
                  value={cfg.appName}
                  onChange={(e) => setCfg((p) => ({ ...p, appName: e.target.value }))}
                  placeholder="DustNote"
                  className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-surface-fg focus:border-accent"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-surface-fg">
                  {t('admin.mp_appid')}
                </label>
                <input
                  value={cfg.miniprogramAppId}
                  onChange={(e) => setCfg((p) => ({ ...p, miniprogramAppId: e.target.value }))}
                  placeholder="wxXXXXXXXXXXXXXXXX"
                  aria-invalid={!!appIdError}
                  className={`w-full rounded-lg border bg-surface-bg px-3 py-2 text-sm text-surface-fg focus:border-accent ${
                    appIdError ? 'border-danger' : 'border-surface-border'
                  }`}
                />
                {appIdError ? (
                  <p className="mt-1 text-xs text-danger">{t(appIdError)}</p>
                ) : (
                  <p className="mt-1 text-xs text-surface-muted">{t('admin.mp_appid_hint')}</p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  className="flex-1 rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-semibold text-accent-strong-on transition-colors hover:bg-accent-strong-hover"
                >
                  {saved ? (
                    t('admin.saved')
                  ) : (
                    <IconText k="admin.save_btn" label={t('admin.save_btn')} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setResetConfirm(true)}
                  className="rounded-lg border border-surface-border px-3 py-2.5 text-xs text-surface-muted transition-colors hover:bg-surface-bg hover:text-surface-fg"
                >
                  {t('admin.reset_btn')}
                </button>
              </div>
            </div>
          )}

          {/* ===== Tab 2: 免配置包下载 ===== */}
          {activeTab === 'download' && (
            <div className="space-y-4">
              <p className="text-sm text-surface-muted">{t('admin.download_hint')}</p>
              {PLATFORMS.map((p) => {
                const content = generatePlatformConfig(p.id);
                const isOpen = previewing === p.id;
                return (
                  <div
                    key={p.id}
                    className="rounded-lg border border-surface-border bg-surface-bg p-4"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Icon name={p.icon} size={20} />
                      <span className="font-semibold text-surface-fg">{t(p.nameKey)}</span>
                    </div>
                    <p className="mb-3 text-xs text-surface-muted">{t(p.descKey)}</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => downloadConfig(p.file, content)}
                        className="rounded bg-accent-soft/60 px-3 py-1.5 text-xs font-medium text-accent-text transition-colors hover:bg-accent-soft"
                      >
                        <IconText
                          k="admin.download_btn"
                          label={t('admin.download_btn', { file: p.file })}
                        />
                      </button>
                      <button
                        onClick={() => void handleCopyConfig(p)}
                        className="rounded border border-surface-border px-3 py-1.5 text-xs text-surface-fg transition-colors hover:bg-surface-2"
                      >
                        {t('admin.copy_btn')}
                      </button>
                      <button
                        onClick={() => setPreviewing(isOpen ? null : p.id)}
                        aria-expanded={isOpen}
                        className="rounded border border-surface-border px-3 py-1.5 text-xs text-surface-fg transition-colors hover:bg-surface-2"
                      >
                        {isOpen ? t('admin.preview_hide') : t('admin.preview_show')}
                      </button>
                    </div>
                    {/* 内容预览：下载前确认将要写入的地址，避免「下错了才发现」 */}
                    {isOpen && (
                      <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-surface-border bg-surface-2 p-3 font-mono text-xs text-surface-fg">
                        {content}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ===== Tab 3: 小程序指引 ===== */}
          {activeTab === 'miniprogram' && (
            <div className="space-y-5">
              <div className="rounded-lg border border-surface-border bg-warning-soft p-4">
                <p className="text-sm font-semibold text-warning">
                  <IconText k="admin.mp_warning_title" label={t('admin.mp_warning_title')} />
                </p>
                <p className="mt-1 text-xs text-warning">{t('admin.mp_warning')}</p>
              </div>

              <div className="space-y-3">
                <h3 className="flex items-center gap-1.5 font-semibold text-surface-fg">
                  <Icon name="device" size={14} />
                  {t('admin.mp_access_title')}
                </h3>
                <div className="rounded-lg border border-surface-border bg-surface-bg p-4">
                  <p className="mb-2 text-sm text-surface-fg">{t('admin.mp_way1')}</p>
                  <p className="text-xs text-surface-muted">
                    {t('admin.mp_way1_desc', { name: cfg.appName || 'DustNote' })}
                  </p>
                </div>
                <div className="rounded-lg border border-surface-border bg-surface-bg p-4">
                  <p className="mb-2 text-sm text-surface-fg">{t('admin.mp_way2')}</p>
                  <div className="my-3 flex h-40 w-40 items-center justify-center rounded-lg bg-surface-2 text-xs text-surface-muted">
                    {t('admin.mp_qrcode')}
                  </div>
                </div>
                <div className="rounded-lg border border-surface-border bg-surface-bg p-4">
                  <p className="mb-2 text-sm text-surface-fg">{t('admin.mp_way3')}</p>
                  <p className="text-xs text-surface-muted">{t('admin.mp_way3_desc')}</p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="flex items-center gap-1.5 font-semibold text-surface-fg">
                  <Icon name="code-block" size={14} />
                  {t('admin.mp_build_title')}
                </h3>
                <ol className="ml-4 list-decimal space-y-2 text-sm text-surface-muted">
                  <li>{t('admin.mp_step1')}</li>
                  <li>{t('admin.mp_step2')}</li>
                  <li>
                    <code className="rounded bg-surface-2 px-1 text-xs">
                      miniprogram/src/state/auth.ts
                    </code>{' '}
                    API_BASE
                  </li>
                  <li>
                    <code className="rounded bg-surface-2 px-1 text-xs">
                      pnpm build:miniprogram
                    </code>
                  </li>
                  <li>
                    <code className="rounded bg-surface-2 px-1 text-xs">miniprogram/dist/</code>
                  </li>
                  <li>{t('admin.mp_step6')}</li>
                </ol>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-surface-border p-3 text-center text-xs text-surface-muted">
          {t('admin.current_addr', { addr: cfg.apiBase })}
        </div>
      </div>

      {/* 恢复默认：两步确认（重置会覆盖 apiBase/应用名/AppID 三个字段） */}
      {resetConfirm && (
        <ConfirmDialog
          title={t('admin.reset_confirm_title')}
          message={t('admin.reset_confirm_msg')}
          confirmLabel={t('admin.reset_btn')}
          variant="danger"
          onConfirm={handleReset}
          onCancel={() => setResetConfirm(false)}
        />
      )}
    </div>
  );
}
