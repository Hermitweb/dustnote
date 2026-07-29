import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { marked } from 'marked';
import { encryptString, randomBytes, toBase64Url, wrapKey } from '@dustnote/shared';
import { useStore } from '../lib/store';
import { getDeviceId } from '../lib/device';
import { sanitizeHtml } from '../lib/sanitize-html';
import { NoteHistoryDialog } from './NoteHistoryDialog';

export function Editor() {
  const { t } = useTranslation();
  const selectedId = useStore((s) => s.selectedNoteId);
  const note = useStore((s) => (selectedId ? s.notes.get(selectedId) : null));
  const plain = useStore((s) => (selectedId ? s.notesPlain.get(selectedId) : null));
  const folders = useStore((s) => s.folders);
  const updateNote = useStore((s) => s.updateNote);
  const deleteNote = useStore((s) => s.deleteNote);
  const viewMode = useStore((s) => s.viewMode);
  const restoreNote = useStore((s) => s.restoreNote);
  const permanentDeleteNote = useStore((s) => s.permanentDeleteNote);
  const moveNote = useStore((s) => s.moveNote);
  const appMode = useStore((s) => s.mode);
  const saveAsTemplate = useStore((s) => s.saveAsTemplate);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>('split');
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);

  // 把当前笔记另存为自定义模板（仅联机模式可用）
  const handleSaveAsTemplate = useCallback(() => {
    if (!plain) return;
    const name = prompt(t('templates.save_as_prompt'), plain.title);
    if (!name) return;
    saveAsTemplate(name, { title: plain.title, content: plain.content, tags: plain.tags })
      .then(() => alert(t('templates.save_success')))
      .catch((err: Error) => alert(t('templates.save_fail', { reason: err.message })));
  }, [plain, saveAsTemplate, t]);

  useEffect(() => {
    if (plain) {
      setTitle(plain.title);
      setContent(plain.content);
    }
  }, [plain]);

  // 回收站视图强制只读预览
  useEffect(() => {
    if (viewMode === 'trash' && mode !== 'preview') setMode('preview');
  }, [viewMode, mode]);

  // 防抖自动保存（回收站笔记不自动保存）
  const autoSave = useCallback(() => {
    if (title !== plain?.title || content !== plain?.content) {
      setSaving(true);
      void updateNote(note!.id, { title, content }).finally(() => setSaving(false));
    }
  }, [title, content, plain, note, updateNote]);

  useEffect(() => {
    if (!note) return;
    if (viewMode === 'trash') return;
    const t = setTimeout(autoSave, 800);
    return () => clearTimeout(t);
  }, [autoSave, note, viewMode]);

  // Ctrl+S 立即保存（绕过防抖，由 use-keyboard-shortcuts 派发 editor:save-now 事件）
  useEffect(() => {
    const saveNow = () => {
      if (note && plain && (title !== plain.title || content !== plain.content)) {
        setSaving(true);
        void updateNote(note.id, { title, content }).finally(() => setSaving(false));
      }
    };
    window.addEventListener('editor:save-now', saveNow);
    return () => window.removeEventListener('editor:save-now', saveNow);
  }, [note, plain, title, content, updateNote]);

  if (!note || !plain) {
    return (
      <main className="flex flex-1 items-center justify-center bg-surface-bg text-surface-muted">
        <div className="text-center">
          <div className="mb-2 text-5xl opacity-50">📝</div>
          <p>{t('editor.empty')}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col bg-surface-bg">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 border-b border-surface-border bg-surface-card px-4 py-2">
        <button
          onClick={() => setMode('edit')}
          disabled={viewMode === 'trash'}
          className={`rounded px-2 py-1 text-xs ${mode === 'edit' ? 'bg-mint-100 text-mint-700 dark:bg-mint-900/40' : 'text-surface-muted hover:bg-surface-bg'} ${viewMode === 'trash' ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          {t('editor.view_edit')}
        </button>
        <button
          onClick={() => setMode('split')}
          disabled={viewMode === 'trash'}
          className={`rounded px-2 py-1 text-xs ${mode === 'split' ? 'bg-mint-100 text-mint-700 dark:bg-mint-900/40' : 'text-surface-muted hover:bg-surface-bg'} ${viewMode === 'trash' ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          {t('editor.view_split')}
        </button>
        <button
          onClick={() => setMode('preview')}
          className={`rounded px-2 py-1 text-xs ${mode === 'preview' ? 'bg-mint-100 text-mint-700 dark:bg-mint-900/40' : 'text-surface-muted hover:bg-surface-bg'}`}
        >
          {t('editor.view_preview')}
        </button>

        <div className="ml-auto flex items-center gap-2">
          {viewMode === 'trash' ? (
            <>
              <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                {t('editor.trash_readonly')}
              </span>
              <button
                onClick={() => void restoreNote(note.id)}
                className="rounded p-1.5 text-xs text-mint-600 hover:bg-mint-50 dark:hover:bg-mint-900/30"
                title={t('editor.restore')}
              >
                ↩️ {t('editor.restore')}
              </button>
              <button
                onClick={() => {
                  if (confirm(t('editor.confirm_perm_delete'))) {
                    void permanentDeleteNote(note.id);
                  }
                }}
                className="rounded p-1.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                title={t('editor.perm_delete')}
              >
                🗑️ {t('editor.perm_delete')}
              </button>
            </>
          ) : (
            <>
              {saving && <span className="text-xs text-surface-muted">{t('editor.saving')}</span>}
              {!saving && title && (
                <span className="text-xs text-surface-muted">✅ {t('editor.save_indicator')}</span>
              )}
              <button
                onClick={() => updateNote(note.id, { isPinned: !note.isPinned })}
                className={`rounded p-1.5 text-xs ${note.isPinned ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40' : 'text-surface-muted hover:bg-surface-bg'}`}
                title={t('editor.pin')}
              >
                📌
              </button>
              <button
                onClick={() => updateNote(note.id, { isFavorite: !note.isFavorite })}
                className={`rounded p-1.5 text-xs ${note.isFavorite ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40' : 'text-surface-muted hover:bg-surface-bg'}`}
                title={t('editor.favorite')}
              >
                ⭐
              </button>
              {/* 移动到文件夹 */}
              <div className="relative">
                <button
                  onClick={() => setShowMoveMenu((v) => !v)}
                  className="rounded p-1.5 text-xs text-surface-muted hover:bg-surface-bg"
                  title={t('editor.move_folder')}
                >
                  📁
                </button>
                {showMoveMenu && (
                  <>
                    {/* 点击外部关闭 */}
                    <div className="fixed inset-0 z-10" onClick={() => setShowMoveMenu(false)} />
                    <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-surface-border bg-surface-card py-1 shadow-lg">
                      <button
                        onClick={() => {
                          void moveNote(note.id, null);
                          setShowMoveMenu(false);
                        }}
                        className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-surface-bg ${note.folderId === null ? 'font-semibold text-mint-600' : 'text-surface-fg'}`}
                      >
                        {t('editor.unfiled')}
                      </button>
                      {folders.length > 0 && (
                        <div className="my-1 border-t border-surface-border" />
                      )}
                      {folders.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => {
                            void moveNote(note.id, f.id);
                            setShowMoveMenu(false);
                          }}
                          className={`block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-surface-bg ${note.folderId === f.id ? 'font-semibold text-mint-600' : 'text-surface-fg'}`}
                        >
                          {f.icon ?? '📁'} {f.name}
                        </button>
                      ))}
                      {folders.length === 0 && (
                        <p className="px-3 py-1.5 text-xs text-surface-muted">{t('editor.no_folders')}</p>
                      )}
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => setShowShare(true)}
                className="rounded p-1.5 text-xs text-surface-muted hover:bg-surface-bg"
                title={t('editor.share')}
              >
                🔗
              </button>
              {appMode === 'online' && (
                <button
                  onClick={() => setShowHistory(true)}
                  className="rounded p-1.5 text-xs text-surface-muted hover:bg-surface-bg"
                  title={t('history.open')}
                >
                  📜
                </button>
              )}
              {appMode === 'online' && (
                <button
                  onClick={handleSaveAsTemplate}
                  className="rounded p-1.5 text-xs text-surface-muted hover:bg-surface-bg"
                  title={t('templates.save_as')}
                >
                  📋
                </button>
              )}
              <button
                onClick={() => {
                  if (confirm(t('editor.confirm_delete'))) {
                    void deleteNote(note.id);
                  }
                }}
                className="rounded p-1.5 text-xs text-surface-muted hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                title={t('editor.delete')}
              >
                🗑️
              </button>
            </>
          )}
        </div>
      </div>

      {/* 标题 */}
      <div className="border-b border-surface-border bg-surface-card px-6 py-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('editor.placeholder')}
          className="w-full bg-transparent text-2xl font-bold text-surface-fg placeholder-surface-muted focus:outline-none"
        />
      </div>

      {/* 内容 */}
      <div className="flex flex-1 overflow-hidden">
        {(mode === 'edit' || mode === 'split') && (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('editor.md_placeholder')}
            className={`flex-1 resize-none bg-surface-bg p-6 font-mono text-sm text-surface-fg placeholder-surface-muted focus:outline-none ${
              mode === 'split' ? 'border-r border-surface-border' : ''
            }`}
          />
        )}
        {(mode === 'preview' || mode === 'split') && (
          <div className="flex-1 overflow-y-auto p-6">
            <div
              className="prose prose-sm max-w-none text-surface-fg dark:prose-invert"
              dangerouslySetInnerHTML={{
                // 导入的 .md/.docx 也会走到这里，同样按不可信内容处理
                __html: sanitizeHtml(marked.parse(content || `*${t('editor.empty_content')}*`) as string),
              }}
            />
          </div>
        )}
      </div>

      {showShare && (
        <ShareDialog
          noteId={note.id}
          title={title}
          content={content}
          onClose={() => setShowShare(false)}
        />
      )}

      {showHistory && (
        <NoteHistoryDialog
          noteId={note.id}
          currentVersion={note.version}
          onClose={() => setShowHistory(false)}
        />
      )}
    </main>
  );
}

function ShareDialog({
  noteId,
  title,
  content,
  onClose,
}: {
  noteId: string;
  title: string;
  content: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [expiresHours, setExpiresHours] = useState('');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const create = useCallback(async () => {
    setSubmitting(true);
    try {
      const { accessToken, masterKey } = useStore.getState();
      if (!masterKey) {
        alert(t('editor.share_not_unlocked'));
        return;
      }

      // shareKey 只在本地生成，服务端永远见不到它
      const shareKey = randomBytes(32);
      const ciphertext = await encryptString(
        shareKey,
        JSON.stringify({ title: title || t('editor.new_note_default'), content })
      );
      // 用 masterKey 包装一份，好让主人换设备后还能还原出完整链接
      const wrappedShareKey = await wrapKey(masterKey, shareKey);

      const r = await fetch(`/api/v1/shares`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Version': __APP_VERSION__,
          'X-Client-Platform': 'web',
          'X-Client-Channel': 'stable',
          'X-Client-Device-Id': getDeviceId(),
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          noteId,
          ciphertext,
          wrappedShareKey,
          password: password || undefined,
          expiresIn: expiresHours ? Number(expiresHours) * 3600 : undefined,
        }),
      });
      const data = (await r.json()) as { token: string; error?: string; message?: string };
      if (!r.ok) {
        alert(t('editor.share_fail', { reason: data.message ?? data.error ?? r.statusText }));
        return;
      }
      // 密钥放 fragment：浏览器不会把 `#` 之后的内容发给服务端
      setShareUrl(`${location.origin}/share/${data.token}#${toBase64Url(shareKey)}`);
    } finally {
      setSubmitting(false);
    }
  }, [noteId, password, expiresHours, title, content, t]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold text-surface-fg">{t('editor.share_title')}</h2>

        {!shareUrl ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-surface-fg">
                {t('editor.share_password')}
              </label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('editor.share_password_hint')}
                className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-surface-fg">
                {t('editor.share_expires')}
              </label>
              <input
                type="number"
                value={expiresHours}
                onChange={(e) => setExpiresHours(e.target.value)}
                placeholder="72"
                className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-lg border border-surface-border px-4 py-2 text-sm text-surface-fg"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => void create()}
                disabled={submitting}
                className="flex-1 rounded-lg bg-mint-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mint-700 disabled:opacity-50"
              >
                {t('editor.share_btn')}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="text-xs font-medium text-surface-fg">{t('editor.share_link')}</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={shareUrl}
                className="flex-1 rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-xs font-mono"
              />
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(shareUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="rounded-lg bg-mint-600 px-3 py-2 text-xs text-white"
              >
                {copied ? `✅ ${t('editor.copied')}` : t('editor.copy_key')}
              </button>
            </div>
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              {t('editor.key_hint')} <strong>{t('editor.key_hint_strong')}</strong>
              {t('editor.key_hint_tail')}
            </p>
            <button
              onClick={onClose}
              className="w-full rounded-lg border border-surface-border px-4 py-2 text-sm text-surface-fg"
            >
              {t('common.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
