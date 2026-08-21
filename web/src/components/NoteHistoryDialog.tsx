/**
 * 笔记历史版本对话框
 *
 * 列出某篇笔记的历史版本快照，支持预览（解密后渲染 Markdown）和恢复。
 * 仅联机模式可用——单机模式笔记存在本地 IndexedDB，无服务端版本快照。
 *
 * 服务端只存密文，解密在客户端完成（与正常笔记加载一致）。
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { marked } from 'marked';
import { decryptString, type NoteVersionMeta } from '@dustnote/shared';
import { useStore } from '../lib/store';
import { getDeviceId } from '../lib/device';
import { useModeStore } from '../lib/mode-store';
import { sanitizeHtml } from '../lib/sanitize-html';
import { ConfirmDialog } from './ConfirmDialog';

/** 拼接绝对 API 地址（桌面端 webview origin 非服务器，必须用 serverUrl） */
function apiBase(): string {
  const { serverUrl } = useModeStore.getState();
  return serverUrl ? `${serverUrl.replace(/\/+$/, '')}/api/v1` : '/api/v1';
}

interface NoteHistoryDialogProps {
  noteId: string;
  /** 当前笔记的乐观锁版本号，恢复时传给服务端 */
  currentVersion: number;
  onClose: () => void;
}

interface VersionRow extends NoteVersionMeta {}

export function NoteHistoryDialog({ noteId, currentVersion, onClose }: NoteHistoryDialogProps) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  // 请求序号：防止快速点击多个版本时，后发请求先返回覆盖先点击的预览
  const requestSeqRef = useRef(0);

  const fetchVersions = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const { accessToken } = useStore.getState();
      const r = await fetch(`${apiBase()}/notes/${noteId}/versions`, {
        headers: {
          'X-Client-Platform': 'web',
          'X-Client-Version': __APP_VERSION__,
          'X-Client-Device-Id': getDeviceId(),
          Authorization: `Bearer ${accessToken}`,
        },
      });
      // Tauri 桌面端相对路径会命中资源服务器返回 HTML，解析前先校验 content-type
      if (!r.headers.get('content-type')?.includes('application/json')) {
        throw new Error('unexpected_response');
      }
      const data = (await r.json()) as {
        versions?: VersionRow[];
        error?: string;
        message?: string;
      };
      if (!r.ok) {
        throw new Error(data.message ?? data.error ?? r.statusText);
      }
      setVersions(data.versions ?? []);
    } catch (err) {
      setError(t('history.load_fail', { reason: (err as Error).message }));
    } finally {
      setLoadingList(false);
    }
  }, [noteId, t]);

  useEffect(() => {
    void fetchVersions();
  }, [fetchVersions]);

  const selectVersion = useCallback(
    async (versionId: string) => {
      const seq = ++requestSeqRef.current;
      setSelectedId(versionId);
      setPreview(null);
      setLoadingPreview(true);
      setError(null);
      try {
        const { accessToken, masterKey } = useStore.getState();
        if (!masterKey) throw new Error('not_unlocked');

        const r = await fetch(`${apiBase()}/notes/${noteId}/versions/${versionId}`, {
          headers: {
            'X-Client-Platform': 'web',
            'X-Client-Version': __APP_VERSION__,
            'X-Client-Device-Id': getDeviceId(),
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (!r.headers.get('content-type')?.includes('application/json')) {
          throw new Error('unexpected_response');
        }
        const data = (await r.json()) as {
          ciphertext: string;
          error?: string;
          message?: string;
        };
        if (!r.ok) {
          throw new Error(data.message ?? data.error ?? r.statusText);
        }
        // 仅应用最后一次点击的响应，避免请求乱序覆盖
        if (seq !== requestSeqRef.current) return;

        // 解密密文（与正常笔记加载流程一致）
        const envelope = JSON.parse(data.ciphertext);
        let plaintext: { title: string; content: string };
        try {
          const json = await decryptString(masterKey, envelope.payload ?? envelope);
          plaintext = JSON.parse(json);
        } catch {
          throw new Error(t('history.decrypt_fail'));
        }
        setPreview({ title: plaintext.title, content: plaintext.content });
      } catch (err) {
        if (seq === requestSeqRef.current) {
          setError(t('history.load_fail', { reason: (err as Error).message }));
        }
      } finally {
        if (seq === requestSeqRef.current) {
          setLoadingPreview(false);
        }
      }
    },
    [noteId, t]
  );

  const restore = useCallback(async () => {
    if (!selectedId) return;

    setRestoring(true);
    setError(null);
    setSuccess(null);
    try {
      const { accessToken } = useStore.getState();
      const r = await fetch(`${apiBase()}/notes/${noteId}/versions/${selectedId}/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Platform': 'web',
          'X-Client-Version': __APP_VERSION__,
          'X-Client-Device-Id': getDeviceId(),
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          version: currentVersion,
          clientUpdatedAt: new Date().toISOString(),
        }),
      });
      const data = (await r.json()) as { error?: string; message?: string; version?: number };
      if (!r.ok) {
        throw new Error(data.message ?? data.error ?? r.statusText);
      }
      setSuccess(t('history.restore_success'));
      // 刷新版本列表（恢复操作本身也会产生一个新快照）
      setTimeout(() => void fetchVersions(), 500);
    } catch (err) {
      setError(t('history.restore_fail', { reason: (err as Error).message }));
    } finally {
      setRestoring(false);
    }
  }, [selectedId, noteId, currentVersion, fetchVersions, t]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-surface-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-surface-border p-4">
          <h2 className="text-lg font-bold text-surface-fg">{t('history.title')}</h2>
          <button onClick={onClose} className="text-surface-muted hover:text-surface-fg">
            ✕
          </button>
        </div>

        {/* 内容区：左侧版本列表 + 右侧预览 */}
        <div className="flex flex-1 overflow-hidden">
          {/* 版本列表 */}
          <div className="w-56 overflow-y-auto border-r border-surface-border p-2">
            {loadingList ? (
              <div className="p-4 text-center text-sm text-surface-muted">
                {t('history.loading')}
              </div>
            ) : versions && versions.length > 0 ? (
              versions.map((v) => (
                <button
                  key={v.id}
                  onClick={() => void selectVersion(v.id)}
                  className={`mb-1 block w-full rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                    selectedId === v.id
                      ? 'bg-mint-100 text-mint-700 dark:bg-mint-900/30'
                      : 'text-surface-fg hover:bg-surface-bg'
                  }`}
                >
                  <div className="font-medium">
                    {t('history.version_label', { n: v.noteVersion })}
                  </div>
                  <div className="mt-0.5 text-surface-muted">
                    {new Date(v.createdAt).toLocaleString('zh-CN')}
                  </div>
                </button>
              ))
            ) : (
              <div className="p-4 text-center text-sm text-surface-muted">{t('history.empty')}</div>
            )}
          </div>

          {/* 预览区 */}
          <div className="flex-1 overflow-y-auto p-4">
            {loadingPreview ? (
              <div className="text-center text-sm text-surface-muted">{t('history.loading')}</div>
            ) : preview ? (
              <div>
                <h3 className="mb-3 text-lg font-bold text-surface-fg">{preview.title}</h3>
                <div
                  className="prose prose-sm max-w-none text-surface-fg dark:prose-invert"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeHtml(marked.parse(preview.content || '') as string),
                  }}
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-surface-muted">
                {t('history.preview')}
              </div>
            )}
          </div>
        </div>

        {/* 消息 + 操作栏 */}
        {(error || success) && (
          <div
            className={`px-4 py-2 text-xs ${
              error
                ? 'bg-red-50 text-red-600 dark:bg-red-900/30'
                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30'
            }`}
          >
            {error ?? success}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-surface-border p-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-surface-border px-4 py-2 text-sm text-surface-fg hover:bg-surface-bg"
          >
            {t('common.close')}
          </button>
          <button
            onClick={() => setShowRestoreConfirm(true)}
            disabled={!selectedId || restoring}
            className="rounded-lg bg-mint-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mint-700 disabled:opacity-50"
          >
            {restoring ? t('history.restoring') : t('history.restore')}
          </button>
        </div>
      </div>

      {showRestoreConfirm && (
        <ConfirmDialog
          title={t('history.restore')}
          message={t('history.restore_confirm')}
          variant="danger"
          confirmLabel={t('common.confirm')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => {
            setShowRestoreConfirm(false);
            void restore();
          }}
          onCancel={() => setShowRestoreConfirm(false)}
        />
      )}
    </div>
  );
}
