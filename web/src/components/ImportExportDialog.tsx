/**
 * 导入 / 导出 对话框
 * - 导入：.txt / .md / .docx（mammoth 动态加载）
 * - 导出：当前笔记 → .md / .html / .json / .pdf
 */

import { useState, useRef } from 'react';
import { useStore } from '../lib/store';
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

export function ImportExportDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('main');
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleImport = async (files: FileList) => {
    setMode('importing');
    setError(null);
    setStatus(`开始导入 ${files.length} 个文件…`);
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f) continue;
      setStatus(`(${i + 1}/${files.length}) 解析 ${f.name}…`);
      try {
        const fmt = detectFormat(f.name);
        if (fmt === 'unknown') {
          setStatus(`(${i + 1}/${files.length}) 跳过不支持的格式：${f.name}`);
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
        setError(`导入 ${f.name} 失败：${(err as Error).message}`);
        fail++;
      }
    }
    setStatus(`✅ 完成：成功 ${ok}，失败 ${fail}`);
    setMode('main');
  };

  const handleExport = async (fmt: 'md' | 'html' | 'json' | 'pdf') => {
    const id = useStore.getState().selectedNoteId;
    if (!id) {
      setError('请先选择一篇笔记');
      return;
    }
    const plain = useStore.getState().notesPlain.get(id);
    if (!plain) {
      setError('笔记未解锁或不存在');
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    const safeTitle = (plain.title || 'note').replace(/[\\/:*?"<>|]/g, '-');
    if (fmt === 'md') {
      downloadBlob(exportAsMarkdown(plain.title, plain.content), `${safeTitle}-${date}.md`);
    } else if (fmt === 'html') {
      downloadBlob(exportAsHtml(plain.title, plain.content), `${safeTitle}-${date}.html`);
    } else if (fmt === 'pdf') {
      setMode('exporting');
      setStatus('正在打开打印对话框…');
      try {
        await printNote(plain.title, plain.content);
        setStatus('✅ 已打开打印对话框，选择"另存为 PDF"保存');
      } catch (err) {
        setError(`打印失败：${(err as Error).message}`);
        setMode('main');
        return;
      }
      setMode('main');
    } else {
      downloadBlob(
        exportAsJson({
          format: 'dustnote.v1',
          exportedAt: new Date().toISOString(),
          note: { title: plain.title, content: plain.content, tags: plain.tags },
        }),
        `${safeTitle}-${date}.json`
      );
    }
    setStatus(`✅ 已导出：${safeTitle}-${date}.${fmt}`);
  };

  const handleExportAll = async () => {
    setMode('exporting');
    setStatus('全量备份中…');
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
      downloadBlob(exportAsJson(payload), `dustnote-backup-${date}.json`);
      setStatus(`✅ 已备份 ${notes.length} 篇笔记`);
    } catch (err) {
      setError(`备份失败：${(err as Error).message}`);
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
          <h2 className="text-lg font-bold text-surface-fg">📥📤 导入 / 导出</h2>
          <button onClick={onClose} className="text-surface-muted hover:text-surface-fg">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          {/* 导入 */}
          <div className="rounded-lg border border-surface-border p-3">
            <h3 className="mb-2 text-sm font-semibold text-surface-fg">导入</h3>
            <p className="mb-2 text-xs text-surface-muted">支持 .txt / .md / .docx</p>
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
              {mode === 'importing' ? status || '导入中…' : '选择文件并导入'}
            </button>
          </div>

          {/* 导出当前笔记 */}
          <div className="rounded-lg border border-surface-border p-3">
            <h3 className="mb-2 text-sm font-semibold text-surface-fg">导出当前笔记</h3>
            <p className="mb-2 text-xs text-surface-muted">需先在编辑区选中一篇笔记</p>
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
            <h3 className="mb-2 text-sm font-semibold text-surface-fg">全量备份</h3>
            <p className="mb-2 text-xs text-surface-muted">客户端解密后打包，文件保存在本地</p>
            <button
              onClick={() => void handleExportAll()}
              disabled={mode !== 'main'}
              className="w-full rounded-lg border border-surface-border px-3 py-2 text-sm text-surface-fg hover:bg-surface-bg disabled:opacity-50"
            >
              {mode === 'exporting' ? status || '备份中…' : '备份为 .json'}
            </button>
          </div>

          {(status || error) && (
            <div
              className={`rounded p-2 text-xs ${error ? 'bg-red-50 text-red-600 dark:bg-red-900/30' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30'}`}
            >
              {error ?? status}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
