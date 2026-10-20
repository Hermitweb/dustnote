/**
 * DiagnosticsPanel 测试
 *
 * 覆盖：
 * - 初次渲染触发 storageUsage + lastBackup 查询
 * - 存储用量展示 + warning 配色
 * - 上次备份时间展示
 * - 导出诊断按钮
 * - 清理缓存成功 / 失败
 * - 桌面端 grace-unlock 选择器（非桌面端不下滑）
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '../test/render';

const mockGetStorageUsage = vi.fn();
const mockGetLastBackupTime = vi.fn();
const mockCleanupCache = vi.fn();
const mockExportDiagnostics = vi.fn();
const mockGetGraceUnlockMin = vi.fn();
const mockSetGraceUnlockMin = vi.fn();
const mockIsTauri = vi.fn(() => false);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => (opts ? `${k}:${JSON.stringify(opts)}` : k),
    i18n: { language: 'zh-CN' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('../lib/db', () => ({
  getStorageUsage: () => mockGetStorageUsage(),
  cleanupCache: () => mockCleanupCache(),
}));

vi.mock('../lib/diagnostics', () => ({
  exportDiagnostics: () => mockExportDiagnostics(),
}));

vi.mock('../lib/auto-backup', () => ({
  getLastBackupTime: () => mockGetLastBackupTime(),
}));

vi.mock('../lib/grace-unlock', () => ({
  getGraceUnlockMin: () => mockGetGraceUnlockMin(),
  setGraceUnlockMin: (m: number) => mockSetGraceUnlockMin(m),
}));

vi.mock('../lib/platform', () => ({
  isTauri: () => mockIsTauri(),
}));

import { DiagnosticsPanel } from './DiagnosticsPanel';

describe('DiagnosticsPanel', () => {
  beforeEach(() => {
    mockGetStorageUsage.mockResolvedValue({ usage: 100, quota: 1000, usagePercent: 10 });
    mockGetLastBackupTime.mockResolvedValue(null);
    mockCleanupCache.mockResolvedValue(undefined);
    mockExportDiagnostics.mockResolvedValue(undefined);
    mockGetGraceUnlockMin.mockReturnValue(0);
    mockSetGraceUnlockMin.mockReturnValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('初次渲染触发 storage + backup 查询', async () => {
    render(<DiagnosticsPanel />);
    await waitFor(() => {
      expect(mockGetStorageUsage).toHaveBeenCalled();
      expect(mockGetLastBackupTime).toHaveBeenCalled();
    });
  });

  it('展示存储用量文本', async () => {
    mockGetStorageUsage.mockResolvedValue({ usage: 500, quota: 1000, usagePercent: 50 });
    const { container } = render(<DiagnosticsPanel />);
    await waitFor(() => {
      expect(container.textContent).toContain('500.0 B');
      expect(container.textContent).toContain('1000.0 B');
    });
  });

  it('usagePercent ≥ 80 触发 warning 样式', async () => {
    mockGetStorageUsage.mockResolvedValue({ usage: 900, quota: 1000, usagePercent: 90 });
    const { container } = render(<DiagnosticsPanel />);
    await waitFor(() => {
      expect(container.textContent).toContain('90%');
      expect(container.querySelector('.text-warning')).not.toBeNull();
    });
  });

  it('展示上次备份时间（无则显示 "never"）', async () => {
    const { container } = render(<DiagnosticsPanel />);
    await waitFor(() => {
      expect(container.textContent).toContain('settings.auto_backup_never');
    });
  });

  it('有备份时间时展示相对时间', async () => {
    const now = Date.now();
    mockGetLastBackupTime.mockResolvedValue(new Date(now - 5 * 60000).toISOString());
    const { container } = render(<DiagnosticsPanel />);
    await waitFor(() => {
      // i18n 直接用真实例（不走 react-i18next mock），翻译为 "5 分钟前"
      expect(container.textContent).toContain('5 分钟前');
    });
  });

  it('点击导出诊断按钮调 exportDiagnostics', async () => {
    const { container } = render(<DiagnosticsPanel />);
    const exportBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('settings.export_diagnostics')
    );
    expect(exportBtn).toBeDefined();
    fireEvent.click(exportBtn!);
    await waitFor(() => {
      expect(mockExportDiagnostics).toHaveBeenCalled();
    });
  });

  it('点击清理缓存：成功路径', async () => {
    const { container } = render(<DiagnosticsPanel />);
    const cleanBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('settings.cleanup_cache')
    );
    expect(cleanBtn).toBeDefined();
    fireEvent.click(cleanBtn!);
    await waitFor(() => {
      expect(mockCleanupCache).toHaveBeenCalled();
      expect(container.textContent).toContain('settings.cache_cleaned');
    });
  });

  it('点击清理缓存：失败路径', async () => {
    mockCleanupCache.mockRejectedValue(new Error('boom'));
    const { container } = render(<DiagnosticsPanel />);
    const cleanBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('settings.cleanup_cache')
    );
    fireEvent.click(cleanBtn!);
    await waitFor(() => {
      expect(container.textContent).toContain('settings.cache_clean_failed');
    });
  });

  it('桌面端显示 grace-unlock 选择器', async () => {
    mockIsTauri.mockReturnValue(true);
    mockGetGraceUnlockMin.mockReturnValue(15);
    const { container } = render(<DiagnosticsPanel />);
    await waitFor(() => {
      const select = container.querySelector('select');
      expect(select).not.toBeNull();
      expect((select as HTMLSelectElement).value).toBe('15');
    });
  });

  it('非桌面端不渲染 grace-unlock 选择器', async () => {
    mockIsTauri.mockReturnValue(false);
    const { container } = render(<DiagnosticsPanel />);
    await waitFor(() => {
      expect(mockGetStorageUsage).toHaveBeenCalled();
    });
    expect(container.querySelector('select')).toBeNull();
  });

  it('桌面端修改 grace-unlock 触发 setGraceUnlockMin', async () => {
    mockIsTauri.mockReturnValue(true);
    mockGetGraceUnlockMin.mockReturnValue(0);
    const { container } = render(<DiagnosticsPanel />);
    await waitFor(() => {
      expect(container.querySelector('select')).not.toBeNull();
    });
    const select = container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, '30');
    expect(mockSetGraceUnlockMin).toHaveBeenCalledWith(30);
  });
});
