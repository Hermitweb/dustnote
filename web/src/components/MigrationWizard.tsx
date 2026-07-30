/**
 * 换电脑环境迁移向导（A-6 防坑）
 *
 * 问题：偏好设置、应用模式、服务器地址都存在 localStorage，换电脑/重装时丢失。
 *
 * 方案：
 * - 导出：把 preferences + mode-store + 语言 打包成 dustnote-env.json 下载
 * - 导入：读取 JSON，恢复 preferences 与 mode-store，提示刷新生效
 *
 * 注意：不导出笔记数据（笔记走全量备份 / 模式切换迁移），只迁移"环境配置"
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { useModeStore } from '../lib/mode-store';
import { toast } from '../lib/toast';
import type { Preferences } from '../lib/store';

const ENV_FILE_NAME = 'dustnote-env.json';
const ENV_MAGIC = 'dustnote-env';

interface EnvExport {
  magic: typeof ENV_MAGIC;
  version: 1;
  exportedAt: string;
  preferences: Preferences;
  modeState: {
    mode: 'standalone' | 'online';
    serverUrl: string | null;
    initialized: boolean;
  };
}

export function MigrationWizard({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const preferences = useStore((s) => s.preferences);
  const setPreferences = useStore((s) => s.setPreferences);

  const handleExport = () => {
    const data: EnvExport = {
      magic: ENV_MAGIC,
      version: 1,
      exportedAt: new Date().toISOString(),
      preferences,
      modeState: {
        mode: useModeStore.getState().mode,
        serverUrl: useModeStore.getState().serverUrl,
        initialized: useModeStore.getState().initialized,
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ENV_FILE_NAME;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t('migration.export_done'));
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as EnvExport;
      if (parsed.magic !== ENV_MAGIC) {
        throw new Error(t('migration.bad_format'));
      }
      // 恢复偏好
      if (parsed.preferences) {
        setPreferences(parsed.preferences);
      }
      // 恢复模式状态
      if (parsed.modeState) {
        useModeStore.getState().setMode(parsed.modeState.mode);
        if (parsed.modeState.serverUrl !== null) {
          useModeStore.getState().setServerUrl(parsed.modeState.serverUrl);
        }
        if (parsed.modeState.initialized) {
          useModeStore.getState().initialize();
        }
      }
      toast.success(t('migration.import_done'));
      onClose();
      // 偏好中的主题/语言需要刷新才能完全生效
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      toast.error(t('migration.import_fail', { reason: (err as Error).message }));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-1 text-sm font-semibold text-surface-fg">
          {t('migration.title')}
        </h4>
        <p className="text-xs text-surface-muted">{t('migration.hint')}</p>
      </div>

      <div className="rounded-lg border border-surface-border bg-surface-bg p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-surface-fg">
            {t('migration.export_title')}
          </span>
          <button
            onClick={handleExport}
            className="rounded bg-mint-600 px-3 py-1 text-xs font-semibold text-white hover:bg-mint-700"
          >
            {t('migration.export_btn')}
          </button>
        </div>
        <p className="text-xs text-surface-muted">{t('migration.export_desc')}</p>
      </div>

      <div className="rounded-lg border border-surface-border bg-surface-bg p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-surface-fg">
            {t('migration.import_title')}
          </span>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="rounded border border-surface-border px-3 py-1 text-xs font-semibold text-surface-fg hover:bg-surface-card disabled:opacity-50"
          >
            {importing ? t('common.loading') : t('migration.import_btn')}
          </button>
        </div>
        <p className="text-xs text-surface-muted">{t('migration.import_desc')}</p>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleImport(f);
            e.target.value = '';
          }}
        />
      </div>

    </div>
  );
}
