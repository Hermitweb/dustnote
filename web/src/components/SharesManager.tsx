/**
 * 分享管理对话框：支持多选批量吊销
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { type Ciphertext, toBase64Url, unwrapKey, zeroize } from '@dustnote/shared';
import { useStore } from '../lib/store';
import { useModeStore } from '../lib/mode-store';
import { getDeviceId } from '../lib/device';
import { toast } from '../lib/toast';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * 构造绝对 API 基址。
 * Tauri 桌面端 webview 的 origin 是 tauri://localhost，
 * 使用相对路径 /api/v1 会请求 Tauri 资源服务器（返回 HTML），
 * 导致 JSON 解析失败 "Unexpected token '<'"。
 * 必须用 mode-store 中的 serverUrl 拼接绝对地址。
 */
function apiBase(): string {
  const { serverUrl } = useModeStore.getState();
  return serverUrl ? `${serverUrl.replace(/\/+$/, '')}/api/v1` : '/api/v1';
}

interface Share {
  id: string;
  noteId: string;
  token: string;
  /** masterKey 包装的 shareKey，用来还原完整分享链接 */
  wrappedShareKey: Ciphertext;
  hasPassword: boolean;
  expiresAt: string | null;
  viewCount: number;
  revoked: boolean;
  createdAt: string;
}

export function SharesManager({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  // 标题不再存服务端，用本地已解密的笔记按 noteId 反查
  const notesPlain = useStore((s) => s.notesPlain);
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** 单条吊销确认：存储待吊销的 shareId */
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null);
  /** 批量吊销确认 */
  const [showBatchRevokeConfirm, setShowBatchRevokeConfirm] = useState(false);

  const exitSelect = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
        if (n.size === 0) setSelecting(false);
        return n;
      }
      n.add(id);
      return n;
    });
  }, []);

  const toggleAll = () => {
    const active = shares.filter((s) => !s.revoked && !isExpired(s.expiresAt));
    if (selectedIds.size === active.length) {
      setSelecting(false);
      setSelectedIds(new Set());
    } else setSelectedIds(new Set(active.map((s) => s.id)));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = useStore.getState().accessToken;
      const r = await fetch(`${apiBase()}/shares`, {
        headers: {
          'X-Client-Version': __APP_VERSION__,
          'X-Client-Platform': 'web',
          'X-Client-Channel': 'stable',
          'X-Client-Device-Id': getDeviceId(),
          Authorization: `Bearer ${token}`,
        },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setShares(((await r.json()) as { shares: Share[] }).shares);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Esc 关闭对话框（a11y）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const revoke = async (id: string) => {
    try {
      const token = useStore.getState().accessToken;
      const r = await fetch(`${apiBase()}/shares/${id}`, {
        method: 'DELETE',
        headers: {
          'X-Client-Version': __APP_VERSION__,
          'X-Client-Platform': 'web',
          'X-Client-Channel': 'stable',
          'X-Client-Device-Id': getDeviceId(),
          Authorization: `Bearer ${token}`,
        },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (err) {
      toast.error(t('shares.revoke_fail', { reason: (err as Error).message }));
    }
  };

  const batchRevoke = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    let ok = 0;
    for (const id of ids) {
      try {
        await fetch(`${apiBase()}/shares/${id}`, {
          method: 'DELETE',
          headers: {
            'X-Client-Version': __APP_VERSION__,
            'X-Client-Platform': 'web',
            'X-Client-Channel': 'stable',
            'X-Client-Device-Id': getDeviceId(),
            Authorization: `Bearer ${useStore.getState().accessToken}`,
          },
        });
        ok++;
      } catch {
        /* skip */
      }
    }
    toast.success(t('shares.batch_done', { count: ok }));
    exitSelect();
    await load();
  };

  /** 用 masterKey 解封 shareKey，拼回带 fragment 的完整链接。shareKey 用后立即零化 */
  const buildShareUrl = useCallback(async (s: Share): Promise<string | null> => {
    const masterKey = useStore.getState().masterKey;
    if (!masterKey) return null;
    let shareKey: Uint8Array | null = null;
    try {
      shareKey = await unwrapKey(masterKey, s.wrappedShareKey);
      return `${location.origin}/share/${s.token}#${toBase64Url(shareKey)}`;
    } catch {
      return null;
    } finally {
      // shareKey 是每次解封出来的临时密钥，用后立即零化
      zeroize(shareKey);
    }
  }, []);

  const copy = async (s: Share) => {
    const url = await buildShareUrl(s);
    if (!url) {
      toast.error(t('shares.unlock_required'));
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopiedId(s.id);
    setTimeout(() => setCopiedId(null), 1500);
  };
  const isExpired = (e: string | null) => (e ? new Date(e).getTime() < Date.now() : false);

  const activeShares = shares.filter((s) => !s.revoked && !isExpired(s.expiresAt));
  const hasAll = selectedIds.size > 0 && selectedIds.size === activeShares.length;
  const selCount = selectedIds.size;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shares-mgr-title"
    >
      <div
        className="flex h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-surface-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-surface-border p-4">
          <h2 id="shares-mgr-title" className="text-lg font-bold text-surface-fg">
            {t('shares.title')}
          </h2>
          <div className="flex items-center gap-2">
            {activeShares.length > 0 && (
              <button
                onClick={() => {
                  if (selecting) exitSelect();
                  else {
                    setSelecting(true);
                    setSelectedIds(new Set(activeShares.map((s) => s.id)));
                  }
                }}
                className="text-xs text-mint-600 hover:text-mint-700"
                aria-pressed={selecting}
              >
                {selecting ? t('shares.exit_select') : t('shares.batch_select')}
              </button>
            )}
            <button
              onClick={onClose}
              className="text-surface-muted hover:text-surface-fg"
              aria-label={t('common.close')}
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="py-8 text-center text-surface-muted" role="status">
              {t('shares.loading')}
            </div>
          )}
          {error && (
            <div className="py-8 text-center text-red-600" role="alert">
              {t('shares.load_fail', { reason: error })}
            </div>
          )}
          {!loading && !error && shares.length === 0 && (
            <div className="py-12 text-center text-surface-muted">
              <div className="mb-2 text-4xl opacity-50">{t('shares.empty_icon')}</div>
              <p>{t('shares.empty')}</p>
            </div>
          )}
          <div className="space-y-2">
            {shares.map((s) => {
              const expired = isExpired(s.expiresAt);
              const checked = selectedIds.has(s.id);
              const canAct = !s.revoked && !expired;
              return (
                <div
                  key={s.id}
                  className={`rounded-lg border border-surface-border p-3 transition-colors ${s.revoked || expired ? 'bg-slate-100 opacity-60 dark:bg-slate-800/50' : checked ? 'bg-mint-100/80 dark:bg-mint-900/20' : 'bg-surface-bg'}`}
                >
                  <div className="mb-2 flex items-start justify-between">
                    <div className="flex items-start gap-2">
                      {selecting && (
                        <button
                          onClick={() => toggleSelect(s.id)}
                          className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors ${checked ? 'border-mint-600 bg-mint-600 text-white' : 'border-surface-border hover:border-mint-400'}`}
                          aria-pressed={checked}
                          aria-label={t('shares.select_all')}
                        >
                          {checked && '✓'}
                        </button>
                      )}
                      <div>
                        <div className="font-semibold text-surface-fg">
                          {notesPlain.get(s.noteId)?.title || t('shares.no_title')}
                        </div>
                        <div className="mt-0.5 text-xs text-surface-muted">
                          {t('shares.created_at', {
                            date: new Date(s.createdAt).toLocaleString('zh-CN'),
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {s.hasPassword && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          {t('shares.password_badge')}
                        </span>
                      )}
                      {s.revoked ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
                          {t('shares.status_revoked')}
                        </span>
                      ) : expired ? (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                          {t('shares.status_expired')}
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                          {t('shares.status_active')}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* 密钥藏在 fragment 里，这里只作示意——务必用「复制链接」拿完整地址 */}
                  <div className="mb-2 truncate font-mono text-xs text-surface-muted">
                    {location.origin}/share/{s.token}
                    <span className="opacity-60">
                      #&lt;{t('shares.link_hint_placeholder')}&gt;
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-surface-muted">
                    <span>{t('shares.view_count', { count: s.viewCount })}</span>
                    {s.expiresAt && (
                      <span>
                        {t('shares.expires_at', {
                          date: new Date(s.expiresAt).toLocaleString('zh-CN'),
                        })}
                      </span>
                    )}
                    {!selecting && (
                      <div className="ml-auto flex gap-1">
                        <button
                          onClick={() => void copy(s)}
                          className="rounded bg-mint-100 px-2 py-1 text-xs text-mint-700 hover:bg-mint-200 dark:bg-mint-900/30 dark:text-mint-300"
                          aria-label={t('shares.copy_link')}
                        >
                          {copiedId === s.id ? t('shares.copied') : t('shares.copy_link')}
                        </button>
                        {canAct && (
                          <button
                            onClick={() => setRevokeTargetId(s.id)}
                            className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100 dark:bg-red-900/30"
                            aria-label={t('shares.revoke')}
                          >
                            {t('shares.revoke')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {selecting && selCount > 0 && (
          <div className="border-t border-surface-border p-3 flex items-center justify-between">
            <span className="text-sm text-surface-muted">
              {t('shares.selected_count', { count: selCount })}
            </span>
            <div className="flex gap-2">
              <button
                onClick={toggleAll}
                className="text-xs text-mint-600 hover:text-mint-700"
                aria-pressed={hasAll}
              >
                {hasAll ? t('shares.deselect_all') : t('shares.select_all')}
              </button>
              <button
                onClick={() => setShowBatchRevokeConfirm(true)}
                className="rounded bg-red-50 px-3 py-1 text-xs text-red-600 hover:bg-red-100 dark:bg-red-900/30"
              >
                {t('shares.batch_revoke')}
              </button>
            </div>
          </div>
        )}

        {!selecting && (
          <button
            onClick={onClose}
            className="w-full border-t border-surface-border p-3 text-center text-xs text-surface-muted hover:bg-surface-bg"
          >
            {t('common.close')}
          </button>
        )}
      </div>

      {revokeTargetId && (
        <ConfirmDialog
          title={t('shares.revoke')}
          message={t('shares.confirm_revoke_one')}
          variant="danger"
          confirmLabel={t('shares.revoke')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => {
            const id = revokeTargetId;
            setRevokeTargetId(null);
            void revoke(id);
          }}
          onCancel={() => setRevokeTargetId(null)}
        />
      )}

      {showBatchRevokeConfirm && (
        <ConfirmDialog
          title={t('shares.batch_revoke')}
          message={t('shares.confirm_revoke_batch', { count: selectedIds.size })}
          variant="danger"
          confirmLabel={t('shares.batch_revoke')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => {
            setShowBatchRevokeConfirm(false);
            void batchRevoke();
          }}
          onCancel={() => setShowBatchRevokeConfirm(false)}
        />
      )}
    </div>
  );
}
