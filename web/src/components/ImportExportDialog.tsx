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
  // 导入增强：拖拽 / 预览 / 冲突策略
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<
    {
      key: string;
      name: string;
      title: string;
      content: string;
      tags: string[];
      included: boolean;
    }[]
  >([]);
  const [conflictStrategy, setConflictStrategy] = useState<'merge' | 'overwrite' | 'skip'>('merge');

  // 解析文件并加入预览列表（不立即导入）
  const prepareImport = async (files: FileList | File[]) => {
    setError(null);
    const arr = Array.from(files);
    const added: typeof preview = [];
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      if (!f) continue;
      if (f.size > 50 * 1024 * 1024) {
        setError(t('import_export.file_too_large', { name: f.name }));
        continue;
      }
      try {
        if (detectFormat(f.name) === 'unknown') {
          setStatus(
            t('import_export.skip_unsupported', { i: i + 1, total: arr.length, name: f.name })
          );
          continue;
        }
        // .docx 由 parseNoteFile 内部动态加载 mammoth 解析
        const pt = await parseNoteFile(f);
        added.push({
          key: `${f.name}-${i}-${Date.now()}`,
          name: f.name,
          title: pt.title,
          content: pt.content,
          tags: pt.tags,
          included: true,
        });
      } catch (err) {
        setError(t('import_export.import_fail', { name: f.name, reason: (err as Error).message }));
      }
    }
    setPreview((prev) => [...prev, ...added]);
    if (added.length > 0) {
      setStatus(t('import_export.preview_ready', { count: added.length }));
    }
  };

  // 按标题匹配已存在的笔记（用于冲突策略）
  const findExistingByTitle = (title: string): string | null => {
    const state = useStore.getState();
    for (const [id, pt] of state.notesPlain) {
      if (state.notes.get(id)?.deletedAt) continue;
      if (pt.title === title) return id;
    }
    return null;
  };

  // 执行导入（含冲突策略：合并 / 覆盖 / 跳过）
  const doImport = async () => {
    const items = preview.filter((p) => p.included);
    if (items.length === 0) return;
    setMode('importing');
    setError(null);
    let ok = 0;
    let fail = 0;
    let skipped = 0;
    const state = useStore.getState();
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      setStatus(t('import_export.parsing', { i: i + 1, total: items.length, name: item.name }));
      try {
        const existingId = findExistingByTitle(item.title);
        if (existingId && conflictStrategy === 'skip') {
          skipped++;
          continue;
        }
        if (existingId && conflictStrategy === 'merge') {
          const existing = state.notesPlain.get(existingId);
          if (existing) {
            const mergedTags = Array.from(new Set([...existing.tags, ...item.tags]));
            await state.updateNote(existingId, {
              title: existing.title,
              content: existing.content ? `${existing.content}\n\n${item.content}` : item.content,
              tags: mergedTags,
            });
            ok++;
            continue;
          }
        }
        if (existingId && conflictStrategy === 'overwrite') {
          await state.updateNote(existingId, {
            title: item.title,
            content: item.content,
            tags: item.tags,
          });
          ok++;
          continue;
        }
        const id = await state.createNote(null);
        await state.updateNote(id, { title: item.title, content: item.content, tags: item.tags });
        ok++;
      } catch (err) {
        setError(
          t('import_export.import_fail', { name: item.name, reason: (err as Error).message })
        );
        fail++;
      }
    }
    setPreview([]);
    setStatus(t('import_export.done_strategy', { ok, fail, skipped }));
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
    const safeTitle = (plain.title || 'note')
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\.\.+/g, '.')
      .replace(/^\.+/, '');
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
        const safeTitle = (pt.title || 'untitled')
          .replace(/[\\/:*?"<>|]/g, '-')
          .replace(/\.\.+/g, '.')
          .replace(/^\.+/, '')
          .slice(0, 60);
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
          {/* 导入：拖拽 / 预览 / 冲突策略 */}
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
                if (e.target.files) void prepareImport(e.target.files);
                e.target.value = '';
              }}
            />
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files.length > 0) void prepareImport(e.dataTransfer.files);
              }}
              className={`rounded-lg border-2 border-dashed p-4 text-center text-xs transition-colors ${
                dragOver
                  ? 'border-mint-500 bg-mint-50 dark:bg-mint-900/30'
                  : 'border-surface-border text-surface-muted'
              }`}
            >
              <button
                onClick={() => fileInput.current?.click()}
                disabled={mode !== 'main'}
                className="rounded-lg bg-mint-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mint-700 disabled:opacity-50"
              >
                {mode === 'importing'
                  ? status || t('import_export.importing')
                  : t('import_export.import_btn')}
              </button>
              <p className="mt-2">{t('import_export.drag_hint')}</p>
            </div>

            {preview.length > 0 && mode === 'main' && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-surface-fg">
                    {t('import_export.preview_title')} ({preview.filter((p) => p.included).length})
                  </span>
                  <button
                    onClick={() => setPreview([])}
                    className="text-xs text-surface-muted underline hover:text-surface-fg"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-surface-border p-1">
                  {preview.map((p) => (
                    <label
                      key={p.key}
                      className="flex items-start gap-2 rounded px-2 py-1 text-xs hover:bg-surface-bg"
                    >
                      <input
                        type="checkbox"
                        checked={p.included}
                        onChange={(e) =>
                          setPreview((prev) =>
                            prev.map((x) =>
                              x.key === p.key ? { ...x, included: e.target.checked } : x
                            )
                          )
                        }
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-surface-fg">
                          {p.title}
                        </span>
                        <span className="block truncate text-surface-muted">
                          {p.content.slice(0, 60) || '—'}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-surface-muted">
                    {t('import_export.conflict_strategy')}:
                  </span>
                  <select
                    value={conflictStrategy}
                    onChange={(e) =>
                      setConflictStrategy(e.target.value as 'merge' | 'overwrite' | 'skip')
                    }
                    className="rounded border border-surface-border bg-surface-bg px-2 py-1 text-xs text-surface-fg focus:outline-none"
                  >
                    <option value="merge">{t('import_export.conflict_merge')}</option>
                    <option value="overwrite">{t('import_export.conflict_overwrite')}</option>
                    <option value="skip">{t('import_export.conflict_skip')}</option>
                  </select>
                </div>
                <p className="text-xs text-surface-muted">{t('import_export.conflict_hint')}</p>
                <button
                  onClick={() => void doImport()}
                  className="w-full rounded-lg bg-mint-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mint-700"
                >
                  {t('import_export.start_import_btn', {
                    count: preview.filter((p) => p.included).length,
                  })}
                </button>
              </div>
            )}
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
              {mode === 'exporting' &&
              status?.includes(t('import_export.backup_start').split('…')[0] ?? '')
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
              {mode === 'exporting' &&
              status?.includes(t('import_export.zip_start').split('…')[0] ?? '')
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
