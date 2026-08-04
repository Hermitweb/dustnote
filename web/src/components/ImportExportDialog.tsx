/**
 * 导入 / 导出 对话框
 * - 导入：.txt / .md / .docx（mammoth 动态加载）
 * - 导出当前笔记：.md / .html / .json / .pdf
 * - 全量备份：所有笔记 + 文件夹 + 标签 → 单个 .json
 * - 批量打包导出：所有笔记 → 各自 .md 文件 → ZIP 压缩包
 *
 * 桌面端（Tauri）使用原生保存对话框，用户可选择保存位置并看到保存路径；
 * Web 端使用浏览器下载，提示文件已下载到默认下载目录。
 */

import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import JSZip from 'jszip';
import { useStore } from '../lib/store';
import { isTauri } from '../lib/platform';
import {
  parseNoteFile,
  exportAsMarkdown,
  exportAsHtml,
  exportAsJson,
  printNote,
  downloadBlob,
  detectFormat,
} from '../lib/io-client';

type Mode = 'main' | 'importing' | 'exporting';

/**
 * 保存 Blob 到文件
 *
 * Tauri 环境：调用原生保存对话框（__dustnoteSaveFile），用户选择保存位置，
 *   返回保存路径（用户取消时返回 null）。
 * Web 环境：触发浏览器下载，返回 undefined（浏览器决定保存位置）。
 *
 * 返回值：
 * - string — Tauri 下用户选择的保存路径
 * - null — Tauri 下用户取消了保存
 * - undefined — Web 下已触发浏览器下载
 */
async function saveBlob(blob: Blob, filename: string): Promise<string | null | undefined> {
  const saveFn = (
    window as unknown as {
      __dustnoteSaveFile?: (filename: string, content: Uint8Array) => Promise<string | null>;
    }
  ).__dustnoteSaveFile;

  if (isTauri() && saveFn) {
    const arrayBuffer = await blob.arrayBuffer();
    return saveFn(filename, new Uint8Array(arrayBuffer));
  }
  // Web：浏览器下载
  downloadBlob(blob, filename);
  return undefined;
}

export function ImportExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('main');
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleImport = async (files: FileList) => {
    setMode('importing');
    setError(null);
    setStatus(t('import_export.start_import', { count: files.length }));
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f) continue;
      setStatus(t('import_export.parsing', { i: i + 1, total: files.length, name: f.name }));
      try {
        const fmt = detectFormat(f.name);
        if (fmt === 'unknown') {
          setStatus(
            t('import_export.skip_unsupported', { i: i + 1, total: files.length, name: f.name })
          );
          fail++;
          continue;
        }
        // .docx 由 parseNoteFile 内部动态加载 mammoth 解析
        const pt = await parseNoteFile(f);
        await useStore.getState().createNote(null);
        const selectedId = useStore.getState().selectedNoteId;
        if (selectedId) {
          await useStore
            .getState()
            .updateNote(selectedId, { title: pt.title, content: pt.content, tags: pt.tags });
        }
        ok++;
      } catch (err) {
        setError(t('import_export.import_fail', { name: f.name, reason: (err as Error).message }));
        fail++;
      }
    }
    setStatus(t('import_export.done', { ok, fail }));
    setMode('main');
  };

  const handleExport = async (fmt: 'md' | 'html' | 'json' | 'pdf') => {
    const id = useStore.getState().selectedNoteId;
    if (!id) {
      setError(t('import_export.no_selection'));
      return;
    }
    const plain = useStore.getState().notesPlain.get(id);
    if (!plain) {
      setError(t('import_export.not_unlocked'));
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    const safeTitle = (plain.title || 'note').replace(/[\\/:*?"<>|]/g, '-');
    if (fmt === 'md') {
      const blob = exportAsMarkdown(plain.title, plain.content);
      const filename = `${safeTitle}-${date}.md`;
      const savedPath = await saveBlob(blob, filename);
      setStatus(
        savedPath
          ? t('import_export.saved_to', { path: savedPath })
          : savedPath === null
            ? t('import_export.save_cancelled')
            : t('import_export.exported', { name: filename }) +
              ' · ' +
              t('import_export.download_hint')
      );
    } else if (fmt === 'html') {
      const blob = exportAsHtml(plain.title, plain.content);
      const filename = `${safeTitle}-${date}.html`;
      const savedPath = await saveBlob(blob, filename);
      setStatus(
        savedPath
          ? t('import_export.saved_to', { path: savedPath })
          : savedPath === null
            ? t('import_export.save_cancelled')
            : t('import_export.exported', { name: filename }) +
              ' · ' +
              t('import_export.download_hint')
      );
    } else if (fmt === 'pdf') {
      setMode('exporting');
      setStatus(t('import_export.opening_print'));
      try {
        await printNote(plain.title, plain.content);
        setStatus(t('import_export.print_opened'));
      } catch (err) {
        setError(t('import_export.print_fail', { reason: (err as Error).message }));
        setMode('main');
        return;
      }
      setMode('main');
    } else {
      const blob = exportAsJson({
        format: 'dustnote.v1',
        exportedAt: new Date().toISOString(),
        note: { title: plain.title, content: plain.content, tags: plain.tags },
      });
      const filename = `${safeTitle}-${date}.json`;
      const savedPath = await saveBlob(blob, filename);
      setStatus(
        savedPath
          ? t('import_export.saved_to', { path: savedPath })
          : savedPath === null
            ? t('import_export.save_cancelled')
            : t('import_export.exported', { name: filename }) +
              ' · ' +
              t('import_export.download_hint')
      );
    }
  };

  const handleExportAll = async () => {
    setMode('exporting');
    setStatus(t('import_export.backup_start'));
    try {
      const state = useStore.getState();
      const notes = Array.from(state.notesPlain.entries())
        .filter(([id]) => !state.notes.get(id)?.deletedAt)
        .map(([id, pt]) => ({
          id,
          title: pt.title,
          content: pt.content,
          tags: pt.tags,
          isPinned: state.notes.get(id)?.isPinned ?? false,
          isFavorite: state.notes.get(id)?.isFavorite ?? false,
        }));
      const payload = {
        format: 'dustnote-backup.v1',
        exportedAt: new Date().toISOString(),
        noteCount: notes.length,
        notes,
        folders: state.folders,
        tags: state.tags,
      };
      const date = new Date().toISOString().slice(0, 10);
      const filename = `dustnote-backup-${date}.json`;
      const blob = exportAsJson(payload);
      const savedPath = await saveBlob(blob, filename);
      if (savedPath) {
        setStatus(t('import_export.saved_to', { path: savedPath }));
      } else if (savedPath === null) {
        setStatus(t('import_export.save_cancelled'));
      } else {
        setStatus(
          t('import_export.backup_done', { count: notes.length }) +
            ' · ' +
            t('import_export.download_hint')
        );
      }
    } catch (err) {
      setError(t('import_export.backup_fail', { reason: (err as Error).message }));
    } finally {
      setMode('main');
    }
  };

  /** 批量打包导出：每篇笔记导出为独立 .md 文件，打包为 ZIP */
  const handleExportZip = async () => {
    setMode('exporting');
    try {
      const state = useStore.getState();
      const entries = Array.from(state.notesPlain.entries()).filter(
        ([id]) => !state.notes.get(id)?.deletedAt
      );
      setStatus(t('import_export.zip_start', { count: entries.length }));

      const zip = new JSZip();
      const usedNames = new Set<string>();

      for (const [, pt] of entries) {
        const safeTitle = (pt.title || 'untitled').replace(/[\\/:*?"<>|]/g, '-').slice(0, 60);
        // 避免同名文件冲突：若已存在则追加序号
        let filename = `${safeTitle}.md`;
        let n = 2;
        while (usedNames.has(filename)) {
          filename = `${safeTitle}-${n}.md`;
          n++;
        }
        usedNames.add(filename);

        const md = pt.content.startsWith('#') ? pt.content : `# ${pt.title}\n\n${pt.content}`;
        // 添加 UTF-8 BOM 确保 Windows 记事本兼容
        const mdWithBom = '\uFEFF' + md;
        zip.file(filename, mdWithBom);
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const date = new Date().toISOString().slice(0, 10);
      const filename = `dustnote-notes-${date}.zip`;
      const savedPath = await saveBlob(blob, filename);

      if (savedPath) {
        setStatus(
          t('import_export.zip_done', { count: entries.length }) +
            ' · ' +
            t('import_export.saved_to', { path: savedPath })
        );
      } else if (savedPath === null) {
        setStatus(t('import_export.save_cancelled'));
      } else {
        setStatus(
          t('import_export.zip_done', { count: entries.length }) +
            ' · ' +
            t('import_export.download_hint')
        );
      }
    } catch (err) {
      setError(t('import_export.zip_fail', { reason: (err as Error).message }));
    } finally {
      setMode('main');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-surface-fg">{t('import_export.title')}</h2>
          <button onClick={onClose} className="text-surface-muted hover:text-surface-fg">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          {/* 导入 */}
          <div className="rounded-lg border border-surface-border p-3">
            <h3 className="mb-2 text-sm font-semibold text-surface-fg">
              {t('import_export.import_title')}
            </h3>
            <p className="mb-2 text-xs text-surface-muted">{t('import_export.import_hint')}</p>
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.md,.markdown,.docx"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void handleImport(e.target.files);
              }}
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={mode !== 'main'}
              className="w-full rounded-lg bg-mint-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mint-700 disabled:opacity-50"
            >
              {mode === 'importing' ? status || t('import_export.importing') : t('import_export.import_btn')}
            </button>
          </div>

          {/* 导出当前笔记 */}
          <div className="rounded-lg border border-surface-border p-3">
            <h3 className="mb-2 text-sm font-semibold text-surface-fg">
              {t('import_export.export_title')}
            </h3>
            <p className="mb-2 text-xs text-surface-muted">{t('import_export.export_hint')}</p>
            <div className="flex gap-2">
              <button
                onClick={() => void handleExport('md')}
                disabled={mode !== 'main'}
                className="flex-1 rounded-lg border border-surface-border px-3 py-2 text-sm text-surface-fg hover:bg-surface-bg disabled:opacity-50"
              >
                .md
              </button>
              <button
                onClick={() => void handleExport('html')}
                disabled={mode !== 'main'}
                className="flex-1 rounded-lg border border-surface-border px-3 py-2 text-sm text-surface-fg hover:bg-surface-bg disabled:opacity-50"
              >
                .html
              </button>
              <button
                onClick={() => void handleExport('json')}
                disabled={mode !== 'main'}
                className="flex-1 rounded-lg border border-surface-border px-3 py-2 text-sm text-surface-fg hover:bg-surface-bg disabled:opacity-50"
              >
                .json
              </button>
              <button
                onClick={() => void handleExport('pdf')}
                disabled={mode !== 'main'}
                className="flex-1 rounded-lg border border-surface-border px-3 py-2 text-sm text-surface-fg hover:bg-surface-bg disabled:opacity-50"
              >
                .pdf
              </button>
            </div>
          </div>

          {/* 全量备份 */}
          <div className="rounded-lg border border-surface-border p-3">
            <h3 className="mb-2 text-sm font-semibold text-surface-fg">
              {t('import_export.backup_title')}
            </h3>
            <p className="mb-2 text-xs text-surface-muted">{t('import_export.backup_hint')}</p>
            <button
              onClick={() => void handleExportAll()}
              disabled={mode !== 'main'}
              className="w-full rounded-lg border border-surface-border px-3 py-2 text-sm text-surface-fg hover:bg-surface-bg disabled:opacity-50"
            >
              {mode === 'exporting' && status?.includes(t('import_export.backup_start').split('…')[0] ?? '')
                ? status
                : t('import_export.backup_btn')}
            </button>
          </div>

          {/* 批量打包导出 */}
          <div className="rounded-lg border border-surface-border p-3">
            <h3 className="mb-2 text-sm font-semibold text-surface-fg">
              {t('import_export.zip_title')}
            </h3>
            <p className="mb-2 text-xs text-surface-muted">{t('import_export.zip_hint')}</p>
            <button
              onClick={() => void handleExportZip()}
              disabled={mode !== 'main'}
              className="w-full rounded-lg border border-surface-border px-3 py-2 text-sm text-surface-fg hover:bg-surface-bg disabled:opacity-50"
            >
              {mode === 'exporting' && status?.includes(t('import_export.zip_start').split('…')[0] ?? '')
                ? t('import_export.zipping')
                : t('import_export.zip_btn')}
            </button>
          </div>

          {(status || error) && (
            <div
              className={`break-all rounded p-2 text-xs ${error ? 'bg-red-50 text-red-600 dark:bg-red-900/30' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30'}`}
            >
              {error ?? status}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
