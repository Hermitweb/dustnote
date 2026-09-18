/**
 * 诊断与维护面板
 *
 * 集成在设置页中，提供：
 * - IndexedDB 存储用量监控（超过 80% 警告）
 * - 上次自动备份时间
 * - 导出诊断日志按钮（脱敏 JSON，供 bug 报告）
 * - 清理缓存按钮（清离线队列/日志/旧备份，保留笔记本身）
 *
 * 防坑：个人项目维护成本最大来源是"用户说出错了你拿不到证据"。
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../lib/i18n';
import { getStorageUsage, cleanupCache } from '../lib/db';
import { exportDiagnostics } from '../lib/diagnostics';
import { getLastBackupTime } from '../lib/auto-backup';
import { isTauri } from '../lib/platform';
import { getGraceUnlockMin, setGraceUnlockMin } from '../lib/grace-unlock';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

/** 相对时间格式化：直接用 i18n 实例（desktop 复用此组件且其 react-i18next
 * 版本无 TFunction 导出，收 t 参数会出现跨包类型不兼容） */
function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffMin < 1) return i18n.t('time.just_now');
  if (diffMin < 60) return i18n.t('time.minutes_ago', { n: diffMin });
  if (diffHour < 24) return i18n.t('time.hours_ago', { n: diffHour });
  if (diffDay < 30) return i18n.t('time.days_ago', { n: diffDay });
  return d.toLocaleDateString();
}

export function DiagnosticsPanel() {
  const { t } = useTranslation();
  const [usage, setUsage] = useState({ usage: 0, quota: 0, usagePercent: 0 });
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [cleaned, setCleaned] = useState(false);
  const [cleanFailed, setCleanFailed] = useState(false);
  const [graceMin, setGraceMin] = useState(0);
  const desktop = isTauri();

  useEffect(() => {
    void getStorageUsage().then(setUsage);
    void getLastBackupTime().then(setLastBackup);
    setGraceMin(getGraceUnlockMin());
  }, []);

  const handleGraceChange = (min: number) => {
    setGraceUnlockMin(min);
    setGraceMin(getGraceUnlockMin());
  };

  const handleCleanup = async (): Promise<void> => {
    try {
      await cleanupCache();
      setCleaned(true);
      setCleanFailed(false);
      void getStorageUsage().then(setUsage);
      setTimeout(() => setCleaned(false), 3000);
    } catch {
      setCleanFailed(true);
      setTimeout(() => setCleanFailed(false), 3000);
    }
  };

  const isWarning = usage.usagePercent >= 80;

  return (
    <div className="rounded-lg border border-surface-border p-3 text-xs text-surface-muted">
      <div className="mb-2 font-semibold text-surface-fg">{t('settings.diagnostics_title')}</div>

      {/* 存储用量 */}
      <div className="mb-2 flex items-center justify-between">
        <span>{t('settings.storage_usage')}</span>
        <span className={isWarning ? 'font-bold text-amber-600 dark:text-amber-400' : ''}>
          {formatBytes(usage.usage)} / {formatBytes(usage.quota)} ({usage.usagePercent}%)
        </span>
      </div>
      {usage.quota > 0 && (
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-bg">
          <div
            className={`h-full rounded-full transition-all ${
              isWarning ? 'bg-amber-500' : 'bg-mint-500'
            }`}
            style={{ width: `${Math.min(100, usage.usagePercent)}%` }}
          />
        </div>
      )}

      {/* 上次自动备份 */}
      <div className="mb-2 flex items-center justify-between">
        <span>{t('settings.auto_backup_last')}</span>
        <span>{lastBackup ? formatTime(lastBackup) : t('settings.auto_backup_never')}</span>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <button
          onClick={() => void exportDiagnostics()}
          className="flex-1 rounded-lg border border-surface-border px-3 py-1.5 text-xs text-surface-fg hover:bg-surface-bg"
        >
          📋 {t('settings.export_diagnostics')}
        </button>
        <button
          onClick={() => void handleCleanup()}
          className="flex-1 rounded-lg border border-surface-border px-3 py-1.5 text-xs text-surface-fg hover:bg-surface-bg"
        >
          {cleaned ? t('settings.cache_cleaned') : t('settings.cleanup_cache')}
        </button>
      </div>
      {cleanFailed && (
        <div className="mt-1 text-red-600 dark:text-red-400">
          {t('settings.cache_clean_failed')}
        </div>
      )}

      {/* 桌面端免密解锁宽限期（S-1） */}
      {desktop && (
        <div className="mt-3 border-t border-surface-border pt-2">
          <div className="mb-1 flex items-center justify-between">
            <span>{t('settings.grace_unlock_title')}</span>
            <select
              value={graceMin}
              onChange={(e) => handleGraceChange(Number(e.target.value))}
              className="rounded border border-surface-border bg-surface-card px-2 py-0.5 text-xs text-surface-fg"
            >
              <option value={0}>{t('settings.grace_unlock_off')}</option>
              <option value={5}>5 min</option>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>60 min</option>
            </select>
          </div>
          <p className="text-surface-muted">{t('settings.grace_unlock_hint')}</p>
        </div>
      )}
    </div>
  );
}
