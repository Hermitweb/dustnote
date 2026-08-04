/**
 * 模式选择对话框（v2.0.0 首次启动 / 设置中切换模式）
 *
 * - 单机模式（standalone）：无服务器，数据存储在本地 IndexedDB
 * - 联机模式（online）：连接服务器，输入 serverUrl 后测试连接
 *
 * 首次启动时全屏显示；设置中切换模式时作为对话框显示。
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModeStore } from '../lib/mode-store';
import { ApiClient } from '@dustnote/shared';
import { getDeviceId } from '../lib/device';

interface ModeSelectDialogProps {
  /** 关闭回调（设置中切换模式时使用；首次启动时不传） */
  onClose?: () => void;
}

type ConnectionState = 'idle' | 'testing' | 'ok' | 'fail';

export function ModeSelectDialog({ onClose }: ModeSelectDialogProps) {
  const { t } = useTranslation();
  const { mode, serverUrl, setMode, setServerUrl, initialize } = useModeStore();
  const isInitial = !useModeStore((s) => s.initialized);

  const [selectedMode, setSelectedMode] = useState<'standalone' | 'online'>(
    mode === 'online' ? 'online' : 'standalone'
  );
  const [urlInput, setUrlInput] = useState(serverUrl ?? '');
  const [connState, setConnState] = useState<ConnectionState>('idle');

  async function testConnection(url: string): Promise<void> {
    setConnState('testing');
    try {
      const baseUrl = url.replace(/\/+$/, '') + '/api/v1';
      const client = new ApiClient({
        baseUrl,
        clientVersion: __APP_VERSION__,
        platform: 'web',
        channel: 'stable',
        deviceId: getDeviceId(),
      });
      await client.get<{ initialized: boolean }>('/auth/status');
      setConnState('ok');
    } catch {
      setConnState('fail');
    }
  }

  function handleContinue() {
    if (selectedMode === 'online') {
      const url = urlInput.trim().replace(/\/+$/, '');
      setServerUrl(url);
      setMode('online');
    } else {
      setMode('standalone');
      setServerUrl(null);
    }
    if (isInitial) {
      initialize();
    }
    onClose?.();
  }

  const canContinue =
    selectedMode === 'standalone' ||
    (selectedMode === 'online' && urlInput.trim().length > 0 && connState === 'ok');

  return (
    <div className={isInitial ? 'fixed inset-0 z-50 flex items-center justify-center bg-surface-bg p-6' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6'}>
      <div className="w-full max-w-2xl rounded-2xl border border-surface-border bg-surface-card p-8 shadow-2xl">
        {/* 标题 */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-mint-100 dark:bg-mint-900/30">
            <img src="/logo.png" alt="" className="h-10 w-10" />
          </div>
          <h1 className="text-2xl font-bold text-surface-fg">{t('mode_select.title')}</h1>
          <p className="mt-2 text-sm text-surface-muted">{t('mode_select.subtitle')}</p>
        </div>

        {/* 模式选择卡片 */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* 单机模式 */}
          <button
            onClick={() => {
              setSelectedMode('standalone');
              setConnState('idle');
            }}
            className={`rounded-xl border-2 p-5 text-left transition-colors ${
              selectedMode === 'standalone'
                ? 'border-mint-500 bg-mint-50 dark:bg-mint-900/20'
                : 'border-surface-border hover:border-mint-300'
            }`}
          >
            <div className="mb-2 text-2xl">💻</div>
            <h2 className="mb-1 text-lg font-semibold text-surface-fg">
              {t('mode_select.standalone_title')}
            </h2>
            <p className="mb-3 text-xs text-surface-muted">
              {t('mode_select.standalone_desc')}
            </p>
            <p className="text-xs font-medium text-mint-600 dark:text-mint-400">
              {t('mode_select.standalone_features')}
            </p>
          </button>

          {/* 联机模式 */}
          <button
            onClick={() => setSelectedMode('online')}
            className={`rounded-xl border-2 p-5 text-left transition-colors ${
              selectedMode === 'online'
                ? 'border-mint-500 bg-mint-50 dark:bg-mint-900/20'
                : 'border-surface-border hover:border-mint-300'
            }`}
          >
            <div className="mb-2 text-2xl">☁️</div>
            <h2 className="mb-1 text-lg font-semibold text-surface-fg">
              {t('mode_select.online_title')}
            </h2>
            <p className="mb-3 text-xs text-surface-muted">{t('mode_select.online_desc')}</p>
            <p className="text-xs font-medium text-mint-600 dark:text-mint-400">
              {t('mode_select.online_features')}
            </p>
          </button>
        </div>

        {/* 联机模式：服务器地址输入 */}
        {selectedMode === 'online' && (
          <div className="mb-6 rounded-xl border border-surface-border bg-surface-bg p-4">
            <label className="mb-1 block text-xs font-medium text-surface-fg">
              {t('mode_select.online_server_url')}
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  setConnState('idle');
                }}
                placeholder={t('mode_select.online_server_url_placeholder')}
                className="flex-1 rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-500/20"
                autoComplete="off"
              />
              <button
                onClick={() => void testConnection(urlInput)}
                disabled={!urlInput.trim() || connState === 'testing'}
                className="rounded-lg bg-surface-card border border-surface-border px-4 py-2 text-xs font-medium text-surface-fg hover:bg-surface-border disabled:opacity-50"
              >
                {connState === 'testing' ? '...' : t('mode_select.online_test')}
              </button>
            </div>
            {connState === 'ok' && (
              <p className="mt-2 text-xs text-mint-600 dark:text-mint-400">
                {t('mode_select.online_test_ok')}
              </p>
            )}
            {connState === 'fail' && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                {t('mode_select.online_test_fail')}
              </p>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3">
          {onClose && (
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-surface-border px-6 py-3 text-sm font-medium text-surface-fg hover:bg-surface-bg"
            >
              {t('common.cancel')}
            </button>
          )}
          <button
            onClick={handleContinue}
            disabled={!canContinue}
            className="flex-1 rounded-lg bg-mint-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-mint-700 disabled:opacity-50"
          >
            {selectedMode === 'standalone'
              ? t('mode_select.continue_standalone')
              : t('mode_select.continue_online')}
          </button>
        </div>
      </div>
    </div>
  );
}
