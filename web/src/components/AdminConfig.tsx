/**
 * 部署管理页面：配置服务器 + 生成各平台免配置包
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, IconText } from './Icon';
import {
  getConfig,
  saveConfig,
  generatePlatformConfig,
  downloadConfig,
  loadConfig,
  type AppConfig,
} from '../lib/config';

type PlatformId = 'web' | 'desktop' | 'miniprogram' | 'android' | 'ios';

const PLATFORMS: {
  id: PlatformId;
  icon: string;
  file: string;
  nameKey: string;
  descKey: string;
}[] = [
  {
    id: 'web',
    icon: '🌐',
    file: 'dustnote-web-config.json',
    nameKey: 'admin.plat_web',
    descKey: 'admin.desc_web',
  },
  {
    id: 'desktop',
    icon: '💻',
    file: 'dustnote-desktop-config.json',
    nameKey: 'admin.plat_desktop',
    descKey: 'admin.desc_desktop',
  },
  {
    id: 'miniprogram',
    icon: '📱',
    file: 'dustnote-miniprogram.txt',
    nameKey: 'admin.plat_miniprogram',
    descKey: 'admin.desc_miniprogram',
  },
  {
    id: 'android',
    icon: '🤖',
    file: 'dustnote-android-config.json',
    nameKey: 'admin.plat_android',
    descKey: 'admin.desc_android',
  },
  {
    id: 'ios',
    icon: '🍎',
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

  useEffect(() => {
    void loadConfig().then(setCfg);
  }, []);

  const handleSave = () => {
    saveConfig(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
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
                  onChange={(e) => setCfg((p) => ({ ...p, apiBase: e.target.value }))}
                  placeholder="https://api.your-domain.com/api/v1"
                  className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-surface-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
                />
                <p className="mt-1 text-xs text-surface-muted">{t('admin.api_base_hint')}</p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-surface-fg">
                  {t('admin.app_name')}
                </label>
                <input
                  value={cfg.appName}
                  onChange={(e) => setCfg((p) => ({ ...p, appName: e.target.value }))}
                  placeholder="DustNote"
                  className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-surface-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
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
                  className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-surface-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
                />
              </div>

              <button
                onClick={handleSave}
                className="w-full rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong-hover"
              >
                {saved ? (
                  t('admin.saved')
                ) : (
                  <IconText k="admin.save_btn" label={t('admin.save_btn')} />
                )}
              </button>
            </div>
          )}

          {/* ===== Tab 2: 免配置包下载 ===== */}
          {activeTab === 'download' && (
            <div className="space-y-4">
              <p className="text-sm text-surface-muted">{t('admin.download_hint')}</p>
              {PLATFORMS.map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg border border-surface-border bg-surface-bg p-4"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xl">{p.icon}</span>
                    <span className="font-semibold text-surface-fg">{t(p.nameKey)}</span>
                  </div>
                  <p className="mb-3 text-xs text-surface-muted">{t(p.descKey)}</p>
                  <button
                    onClick={() => downloadConfig(p.file, generatePlatformConfig(p.id))}
                    className="rounded bg-accent-soft/60 px-3 py-1.5 text-xs font-medium text-accent-text transition-colors hover:bg-accent-soft dark:bg-accent/30 dark:text-accent-text"
                  >
                    <IconText
                      k="admin.download_btn"
                      label={t('admin.download_btn', { file: p.file })}
                    />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ===== Tab 3: 小程序指引 ===== */}
          {activeTab === 'miniprogram' && (
            <div className="space-y-5">
              <div className="rounded-lg border border-surface-border bg-warning-soft p-4 dark:bg-warning-soft">
                <p className="text-sm font-semibold text-warning">
                  <IconText k="admin.mp_warning_title" label={t('admin.mp_warning_title')} />
                </p>
                <p className="mt-1 text-xs text-warning dark:text-warning">
                  {t('admin.mp_warning')}
                </p>
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
                  <div className="my-3 flex h-40 w-40 items-center justify-center rounded-lg bg-surface-2 text-xs text-surface-muted dark:bg-surface-3">
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
                    <code className="rounded bg-surface-2 px-1 text-xs dark:bg-surface-3">
                      miniprogram/src/state/auth.ts
                    </code>{' '}
                    API_BASE
                  </li>
                  <li>
                    <code className="rounded bg-surface-2 px-1 text-xs dark:bg-surface-3">
                      pnpm build:miniprogram
                    </code>
                  </li>
                  <li>
                    <code className="rounded bg-surface-2 px-1 text-xs dark:bg-surface-3">
                      miniprogram/dist/
                    </code>
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
    </div>
  );
}
