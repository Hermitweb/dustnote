/**
 * 小程序笔记编辑（v2.0.0 双模式）
 *
 * 数据访问统一通过 getRepo()（standalone → LocalRepository，online → RemoteRepository）
 * 接入 E2EE：加载时解密显示，保存时加密后提交
 *
 * 功能：
 * - 自动保存（输入停止 1500ms 后触发）
 * - 顶栏置顶 / 收藏 / 删除图标按钮
 * - 保存状态指示器
 * - 分享功能仅联机模式可用（单机模式隐藏分享按钮）
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Input, Textarea, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { encryptString, randomBytes, toBase64Url, wrapKey, noteAad } from '@dustnote/shared';
import { getApi, useAuthStore, decryptNote, encryptNote, parseEnvelope } from '../../state/auth';
import { getRepo } from '../../lib/get-repo';
import { useModeStore } from '../../lib/mode-store';
import { t, useLanguage } from '../../lib/i18n';
import Markdown from '../../lib/markdown';
import { filterSlashCommands, resolveSlashCommand } from '../../lib/slash-commands';
import { enqueueOffline, flushOfflineQueue, isNetworkError } from '../../lib/offline-queue';
import { toMergeable, type ConflictContext, type NoteMetadata } from '@dustnote/client-core';

interface Folder {
  id: string;
  name: string;
}

interface NoteData {
  id: string;
  ciphertext: string;
  keyVersion: number;
  isPinned: boolean;
  isFavorite: boolean;
  deletedAt: string | null;
  version: number;
  folderId: string | null;
  clientUpdatedAt: string;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'unsaved';

/** 服务端历史版本元数据（GET /notes/:id/versions 返回项） */
interface NoteVersionMeta {
  id: string;
  version: number;
  createdAt: string;
}

/** 分享有效期选项（labelKey 为词典 key，文案随语言切换；seconds：秒；0 = 永久） */
const SHARE_EXPIRY_OPTIONS = [
  { key: '1d', labelKey: 'editor.expiry_1d', seconds: 86400 },
  { key: '7d', labelKey: 'editor.expiry_7d', seconds: 604800 },
  { key: '30d', labelKey: 'editor.expiry_30d', seconds: 2592000 },
  { key: 'forever', labelKey: 'editor.expiry_forever', seconds: 0 },
] as const;
type ShareExpiryKey = (typeof SHARE_EXPIRY_OPTIONS)[number]['key'];

export default function NoteEdit() {
  const instance = Taro.getCurrentInstance();
  const id = instance && instance.router && instance.router.params && instance.router.params.id;
  const masterKey = useAuthStore((s) => s.masterKey);
  const mode = useModeStore((s) => s.mode);
  const lang = useLanguage();

  // 语言切换后同步原生导航栏标题
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('app.name') });
  }, [lang]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  // 保留原始 tags，保存时一起加密回去
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState<NoteData | null>(null);
  const noteRef = useRef(note);
  noteRef.current = note;
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [preview, setPreview] = useState(false);
  // 分享创建弹窗：可选密码 / 有效期
  const [shareOpen, setShareOpen] = useState(false);
  const [sharePwd, setSharePwd] = useState('');
  const [shareExpiry, setShareExpiry] = useState<ShareExpiryKey>('forever');
  const [sharing, setSharing] = useState(false);
  // 历史版本弹窗（联机模式）
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<NoteVersionMeta[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // 斜杠命令
  const [showSlash, setShowSlash] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const slashCommands = React.useMemo(() => filterSlashCommands(slashQuery), [slashQuery]);
  // 反向链接：引用当前笔记标题的其他笔记
  const [backlinks, setBacklinks] = useState<{ id: string; title: string }[]>([]);

  // 用于追踪是否已初始化加载，避免初始 load 触发自动保存
  const loadedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 最近一次成功同步的明文（作为 409 三方合并的 base）；加载/保存成功后更新
  const basePlainRef = useRef<{ title: string; content: string; tags: string[] } | null>(null);

  useEffect(() => {
    if (!id || !masterKey) return;
    void (async () => {
      try {
        const snapshot = await getRepo().loadAll();
        const n = snapshot.notes.find((x) => x.id === id) as NoteData | undefined;
        if (!n) {
          Taro.showToast({ title: t('editor.note_not_found'), icon: 'none' });
          return;
        }
        setNote(n);
        // 解析信封并解密明文
        try {
          const envelope = parseEnvelope(n.ciphertext);
          const pt = await decryptNote(
            masterKey,
            envelope,
            noteAad(id, useAuthStore.getState().userId ?? '')
          );
          setTitle(pt.title);
          setContent(pt.content);
          setTags(pt.tags);
          // 记录 base 明文（三方合并的公共祖先）
          basePlainRef.current = { title: pt.title, content: pt.content, tags: pt.tags };
          // 反向链接：解密全部笔记一次，找出引用了本标题的（与 web 端语义一致）
          const bl: { id: string; title: string }[] = [];
          const aadUserId = useAuthStore.getState().userId ?? '';
          for (const other of snapshot.notes) {
            if (other.id === id || other.deletedAt) continue;
            try {
              const oEnv = parseEnvelope(other.ciphertext);
              const oPt = await decryptNote(
                masterKey,
                oEnv,
                oEnv.payload.a === 1 ? noteAad(other.id, aadUserId) : undefined
              );
              if (oPt.content.includes(`[[${pt.title}]]`) || oPt.content.includes(`[[${pt.title}|`)) {
                bl.push({ id: other.id, title: oPt.title });
              }
            } catch {
              // 单条解密失败（密钥轮换等）不阻塞反向链接构建
            }
          }
          setBacklinks(bl);
        } catch {
          setTitle(t('common.decrypt_failed'));
          setContent('');
        }
        loadedRef.current = true;
      } catch {
        Taro.showToast({ title: t('common.load_failed'), icon: 'none' });
      }
    })();
  }, [id, masterKey]);

  const save = useCallback(async () => {
    const cur = noteRef.current;
    if (!cur || !masterKey) return;
    setSaveStatus('saving');
    try {
      // 加密明文后提交
      const { json: cipherJson } = await encryptNote(masterKey, { title, content, tags });
      const newVersion = await getRepo().updateNote(cur.id, {
        ciphertext: cipherJson,
        keyVersion: 1,
        isPinned: cur.isPinned,
        isFavorite: cur.isFavorite,
      });
      // 更新本地 version，防止下次保存用旧版本号导致 409 冲突
      setNote((prev) => (prev ? { ...prev, version: newVersion } : prev));
      basePlainRef.current = { title, content, tags };
      setSaveStatus('saved');
      // 网络恢复：顺手重放离线队列中的未同步修改
      if (mode === 'online') void flushOfflineQueue();
    } catch (err: any) {
      const status = err?.err?.status;
      if (status === 409) {
        Taro.showToast({ title: t('editor.version_conflict'), icon: 'none' });
        setSaveStatus('error');
      } else if (mode === 'online' && isNetworkError(err)) {
        // 网络不可用：入队待同步（携带三方合并上下文，重放时字段级合并）
        try {
          const { json: cipherJson } = await encryptNote(masterKey, { title, content, tags });
          const meta: NoteMetadata = {
            isPinned: cur.isPinned,
            isFavorite: cur.isFavorite,
            deletedAt: cur.deletedAt,
            folderId: cur.folderId,
            clientUpdatedAt: cur.clientUpdatedAt,
          };
          const conflictCtx: ConflictContext | undefined = basePlainRef.current
            ? {
                noteId: cur.id,
                baseVersion: cur.version,
                base: toMergeable(cur.id, basePlainRef.current, meta),
                local: toMergeable(cur.id, { title, content, tags }, meta),
              }
            : undefined;
          await enqueueOffline(
            'PATCH',
            `/notes/${cur.id}`,
            {
              ciphertext: cipherJson,
              keyVersion: 1,
              isPinned: cur.isPinned,
              isFavorite: cur.isFavorite,
              version: cur.version,
              clientUpdatedAt: new Date().toISOString(),
            },
            { noteId: cur.id, ...(conflictCtx ? { conflictCtx } : {}) }
          );
          setSaveStatus('saved');
        } catch {
          Taro.showToast({ title: t('editor.save_failed'), icon: 'none', duration: 3000 });
          setSaveStatus('error');
        }
      } else {
        const msg = err?.err?.message || err?.message || t('common.unknown_error');
        console.error('[save]', err);
        Taro.showToast({ title: t('editor.save_failed_msg', { msg }), icon: 'none', duration: 3000 });
        setSaveStatus('error');
      }
    }
  }, [masterKey, title, content, tags, mode]);

  // 用 ref 持有最新 save，避免 setTimeout 闭包拿到旧的 note/version
  const saveRef = useRef(save);
  saveRef.current = save;

  // 自动保存：title / content 变化且加载完成后，1500ms 防抖触发
  useEffect(() => {
    if (!loadedRef.current || !noteRef.current) return;
    setSaveStatus('unsaved');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void saveRef.current?.();
    }, 1500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [title, content, tags]);

  const onManualSave = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await save();
  };

  const togglePinned = async () => {
    const cur = noteRef.current;
    if (!cur) return;
    const next = !cur.isPinned;
    setNote({ ...cur, isPinned: next });
    try {
      const newVersion = await getRepo().updateNote(cur.id, { isPinned: next });
      setNote((p) => (p ? { ...p, version: newVersion } : p));
      Taro.showToast({ title: next ? t('editor.pinned') : t('editor.unpinned'), icon: 'none' });
    } catch {
      setNote({ ...cur, isPinned: !next });
      Taro.showToast({ title: t('common.operation_failed'), icon: 'none' });
    }
  };

  const toggleFavorite = async () => {
    const cur = noteRef.current;
    if (!cur) return;
    const next = !cur.isFavorite;
    setNote({ ...cur, isFavorite: next });
    try {
      const newVersion = await getRepo().updateNote(cur.id, { isFavorite: next });
      setNote((p) => (p ? { ...p, version: newVersion } : p));
      Taro.showToast({ title: next ? t('editor.favorited') : t('editor.unfavorited'), icon: 'none' });
    } catch {
      setNote({ ...cur, isFavorite: !next });
      Taro.showToast({ title: t('common.operation_failed'), icon: 'none' });
    }
  };

  const onDelete = async () => {
    const cur = noteRef.current;
    if (!cur) return;
    const confirm = await Taro.showModal({
      title: t('editor.delete_title'),
      content: t('editor.delete_content'),
      confirmText: t('common.delete'),
      confirmColor: '#E07B6C',
    });
    if (!confirm.confirm) return;
    try {
      await getRepo().deleteNote(cur.id);
      Taro.showToast({ title: t('common.deleted'), icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 500);
    } catch {
      Taro.showToast({ title: t('common.delete_failed'), icon: 'none' });
    }
  };

  // 打开分享创建弹窗（仅联机模式）：可选密码 / 有效期
  const openShare = () => {
    const cur = noteRef.current;
    if (!cur) return;
    if (mode === 'standalone') {
      Taro.showToast({ title: t('editor.standalone_no_share'), icon: 'none' });
      return;
    }
    if (!useAuthStore.getState().masterKey) {
      Taro.showToast({ title: t('common.need_unlock'), icon: 'none' });
      return;
    }
    setSharePwd('');
    setShareExpiry('forever');
    setShareOpen(true);
  };

  // 生成分享链接并复制到剪贴板（支持可选密码 / 有效期，字段与服务端 /shares 一致）
  const doCreateShare = async () => {
    const cur = noteRef.current;
    if (!cur) return;
    const mk = useAuthStore.getState().masterKey;
    if (!mk) {
      Taro.showToast({ title: t('common.need_unlock'), icon: 'none' });
      return;
    }
    const pwd = sharePwd.trim();
    if (pwd && (pwd.length < 4 || pwd.length > 64)) {
      // 与服务端 CreateShareSchema（min 4）及 web 端预校验一致
      Taro.showToast({ title: t('editor.pwd_length'), icon: 'none' });
      return;
    }
    const opt = SHARE_EXPIRY_OPTIONS.find((o) => o.key === shareExpiry) ?? SHARE_EXPIRY_OPTIONS[3]!;
    setSharing(true);
    try {
      // shareKey 只在本地生成，服务端只收到密文
      const shareKey = randomBytes(32);
      const ciphertext = await encryptString(
        shareKey,
        JSON.stringify({ title: title || t('editor.unnamed_note'), content: content || '' })
      );
      const wrappedShareKey = await wrapKey(mk, shareKey);

      const body: Record<string, unknown> = {
        noteId: cur.id,
        ciphertext,
        wrappedShareKey,
      };
      if (pwd) body.password = pwd;
      if (opt.seconds > 0) body.expiresIn = opt.seconds;

      const r = await getApi().post<{ token: string }>('/shares', body);

      // 密钥只放在页面路由参数里（H5 走 hash，weapp 是本地页面路径），不会发给服务端
      const key = toBase64Url(shareKey);
      // H5 分支不能用写死的 localhost（指向访客本机）；用当前页面 origin 拼同源分享链接
      const shareUrl =
        process.env.TARO_ENV === 'h5'
          ? `${window.location.origin}/#/pages/share/index?token=${r.token}&key=${key}`
          : `/pages/share/index?token=${r.token}&key=${key}`;
      await Taro.setClipboardData({ data: shareUrl });
      setShareOpen(false);
      Taro.showToast({ title: t('editor.share_link_copied'), icon: 'success' });
    } catch (err: any) {
      const msg = err?.err?.message || err?.message || t('common.unknown_error');
      Taro.showToast({ title: t('editor.share_failed_msg', { msg }), icon: 'none', duration: 3000 });
    } finally {
      setSharing(false);
    }
  };

  // 移动笔记到指定文件夹（或移出文件夹）
  const onMoveFolder = async () => {
    const cur = noteRef.current;
    if (!cur) return;
    let folders: Folder[] = [];
    try {
      const snapshot = await getRepo().loadAll();
      folders = snapshot.folders as Folder[];
    } catch {
      Taro.showToast({ title: t('editor.load_folders_failed'), icon: 'none' });
      return;
    }
    const itemList = [t('editor.uncategorized'), ...folders.map((f) => f.name)];
    let tapIndex: number;
    try {
      const res = await Taro.showActionSheet({ itemList });
      tapIndex = res.tapIndex;
    } catch (err) {
      // 用户取消 showActionSheet 也会 throw，过滤掉
      const msg = (err as { errMsg?: string })?.errMsg ?? '';
      if (msg.includes('cancel')) return;
      Taro.showToast({ title: t('common.operation_failed'), icon: 'none' });
      return;
    }
    let folderId: string | null = null;
    let folderName = t('editor.uncategorized');
    if (tapIndex > 0) {
      const f = folders[tapIndex - 1];
      folderId = f.id;
      folderName = f.name;
    }
    try {
      await getRepo().moveNote(cur.id, folderId);
      setNote({ ...cur, folderId });
      Taro.showToast({
        title: folderId ? t('editor.moved_to', { name: folderName }) : t('editor.moved_out'),
        icon: 'none',
      });
    } catch {
      Taro.showToast({ title: t('editor.move_failed'), icon: 'none' });
    }
  };

  // ========== 历史版本（联机模式） ==========

  /** 打开历史版本弹窗并加载列表 */
  const openHistory = async () => {
    if (mode !== 'online') {
      Taro.showToast({ title: t('editor.no_history_standalone'), icon: 'none' });
      return;
    }
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const r = await getApi().get<{ versions: NoteVersionMeta[] }>(`/notes/${id}/versions`);
      setVersions(r.versions ?? []);
    } catch {
      Taro.showToast({ title: t('editor.load_history_failed'), icon: 'none' });
      setHistoryOpen(false);
    } finally {
      setHistoryLoading(false);
    }
  };

  /** 恢复指定历史版本：拉密文 → 解密 → 服务端 restore → 更新编辑器 */
  const onRestoreVersion = async (v: NoteVersionMeta) => {
    const confirm = await Taro.showModal({
      title: t('editor.restore_title'),
      content: t('editor.restore_content', {
        version: v.version,
        time: new Date(v.createdAt).toLocaleString(),
      }),
      confirmText: t('common.restore'),
    });
    if (!confirm.confirm) return;
    try {
      if (!masterKey) throw new Error(t('editor.not_unlocked'));
      // 1. 拉取版本密文
      const r = await getApi().get<{ ciphertext: string }>(`/notes/${id}/versions/${v.id}`);
      // 2. 解密（新密文 AAD 绑定 noteId||userId）
      const env = parseEnvelope(r.ciphertext);
      const aad = noteAad(id ?? '', useAuthStore.getState().userId ?? '');
      const json = await decryptNote(masterKey, env, env.payload.a === 1 ? aad : undefined);
      // 3. 服务端 restore（乐观锁：带当前 version）
      const restoreR = await getApi().request('POST', `/notes/${id}/versions/${v.id}/restore`, {
        version: noteRef.current?.version,
      });
      const restored = restoreR as { version: number };
      // 4. 更新编辑器 + 本地 note（防止下次保存 409）
      setTitle(json.title);
      setContent(json.content);
      if (noteRef.current) {
        setNote({ ...noteRef.current, version: restored.version ?? noteRef.current.version + 1 });
      }
      setHistoryOpen(false);
      Taro.showToast({ title: t('editor.restored_to', { version: v.version }), icon: 'success' });
    } catch (err) {
      Taro.showToast({
        title: t('editor.restore_failed_msg', {
          msg: err instanceof Error ? err.message : t('common.unknown_error'),
        }),
        icon: 'none',
      });
    }
  };

  // wikilink 跳转：[[标题]] 点击 -> 解析目标笔记 id -> 重定向到编辑页
  // （解密全库一次建标题索引，库不大时开销可接受；找不到给提示）
  const onWikilink = async (targetTitle: string) => {
    if (!masterKey) {
      Taro.showToast({ title: t('common.need_unlock'), icon: 'none' });
      return;
    }
    try {
      const snapshot = await getRepo().loadAll();
      const userId = useAuthStore.getState().userId ?? '';
      for (const other of snapshot.notes) {
        if (other.deletedAt) continue;
        try {
          const oEnv = parseEnvelope(other.ciphertext);
          const oPt = await decryptNote(
            masterKey,
            oEnv,
            oEnv.payload.a === 1 ? noteAad(other.id, userId) : undefined
          );
          if (oPt.title === targetTitle) {
            // 同一篇笔记无需跳转
            if (other.id === id) {
              Taro.showToast({ title: t('editor.current_note'), icon: 'none' });
              return;
            }
            Taro.redirectTo({ url: `/pages/note/edit?id=${other.id}` });
            return;
          }
        } catch {
          // 单条解密失败跳过
        }
      }
      Taro.showToast({ title: t('editor.note_not_exist', { title: targetTitle }), icon: 'none' });
    } catch {
      Taro.showToast({ title: t('editor.jump_failed'), icon: 'none' });
    }
  };

  // 反向链接点击：直接跳转来源笔记
  const onBacklinkTap = (noteId: string) => {
    Taro.redirectTo({ url: `/pages/note/edit?id=${noteId}` });
  };

  const statusText = (() => {
    switch (saveStatus) {
      case 'saving':
        return t('editor.status_saving');
      case 'saved':
        return t('editor.status_saved');
      case 'error':
        return t('editor.status_error');
      case 'unsaved':
        return t('editor.status_unsaved');
      default:
        return '';
    }
  })();

  return (
      <View className="page">
      <View className="topbar">
        <Text className="topbar-back" onClick={() => Taro.navigateBack()}>
          ←
        </Text>
        <Text className="save-indicator">{statusText}</Text>
        <View className="topbar-actions">
          <Text
            className={`mint-btn mint-btn-sm mint-btn-ghost${preview ? ' icon-btn-active' : ''}`}
            onClick={() => setPreview((v) => !v)}
          >
            {preview ? t('editor.edit') : t('editor.preview')}
          </Text>
          <Text
            className={`icon-btn${note?.isPinned ? ' icon-btn-active' : ''}`}
            onClick={togglePinned}
          >
            📌
          </Text>
          <Text
            className={`icon-btn${note?.isFavorite ? ' icon-btn-active' : ''}`}
            onClick={toggleFavorite}
          >
            ⭐
          </Text>
          <Text className="icon-btn" onClick={onMoveFolder}>
            📁
          </Text>
          {mode === 'online' && (
            <Text className="icon-btn" onClick={openShare}>
              🔗
            </Text>
          )}
          {mode === 'online' && (
            <Text className="icon-btn" onClick={() => void openHistory()}>
              🕘
            </Text>
          )}
          <Text className="icon-btn" onClick={onDelete}>
            🗑️
          </Text>
          <Text className="mint-btn mint-btn-sm" onClick={onManualSave}>
            {t('editor.save')}
          </Text>
        </View>
      </View>

      <View className="editor-body">
        <Input
          className="mint-input-title"
          value={title}
          onInput={(e) => setTitle((e.detail as { value: string }).value)}
          placeholder={t('editor.title_placeholder')}
        />

        {preview ? (
          <ScrollView scrollY className="flex-1">
            <View className="md-preview">
              <Markdown content={content} onWikilink={(target) => void onWikilink(target)} />
            </View>
            {backlinks.length > 0 && (
              <View className="backlinks-card">
                <Text className="backlinks-title">
                  {t('editor.backlinks_count', { count: backlinks.length })}
                </Text>
                {backlinks.map((bl) => (
                  <Text key={bl.id} className="backlink-item" onClick={() => onBacklinkTap(bl.id)}>
                    📄 {bl.title}
                  </Text>
                ))}
              </View>
            )}
          </ScrollView>
        ) : (
          <>
          <Textarea
            className="mint-textarea flex-1"
            value={content}
            onInput={(e) => {
              const val = (e.detail as { value: string }).value;
              setContent(val);
              // 斜杠命令检测
              const lastNewline = val.lastIndexOf('\n');
              const currentLine = val.slice(lastNewline + 1);
              if (currentLine.startsWith('/') && !currentLine.includes(' ')) {
                setShowSlash(true);
                setSlashQuery(currentLine.slice(1));
              } else {
                setShowSlash(false);
              }
            }}
            placeholder={t('editor.content_placeholder')}
            autoHeight
          />
          {/* 斜杠命令菜单 */}
          {showSlash && slashCommands.length > 0 && (
            <View className="slash-menu">
              {slashCommands.map((cmd) => (
                <View
                  key={cmd.id}
                  className="slash-item"
                  onClick={() => {
                    const resolved = resolveSlashCommand(cmd.insert);
                    const lastNewline = content.lastIndexOf('\n');
                    const before = content.slice(0, lastNewline + 1);
                    setContent(before + resolved);
                    setShowSlash(false);
                  }}
                >
                  <Text className="slash-icon">{cmd.icon}</Text>
                  <Text className="slash-label">{cmd.label}</Text>
                </View>
              ))}
            </View>
          )}
          </>
        )}
      </View>
      {shareOpen && (
        <View className="modal-mask" onClick={() => !sharing && setShareOpen(false)}>
          <View className="modal-card" onClick={(e) => e.stopPropagation()}>
            <Text className="modal-title">{t('editor.share_title')}</Text>
            <Input
              className="mint-input"
              password
              placeholder={t('editor.share_pwd_placeholder')}
              value={sharePwd}
              onInput={(e) => setSharePwd((e.detail as { value: string }).value)}
            />
            <Text className="hint">{t('editor.expiry')}</Text>
            <View className="row gap-s mt-s mb-m">
              {SHARE_EXPIRY_OPTIONS.map((opt) => (
                <Text
                  key={opt.key}
                  className={`expiry-chip${shareExpiry === opt.key ? ' expiry-chip-active' : ''}`}
                  onClick={() => setShareExpiry(opt.key)}
                >
                  {t(opt.labelKey)}
                </Text>
              ))}
            </View>
            <View className="row gap-m">
              <View
                className="mint-btn mint-btn-ghost flex-1"
                onClick={() => !sharing && setShareOpen(false)}
              >
                {t('common.cancel')}
              </View>
              <View
                className="mint-btn flex-1"
                style={{ opacity: sharing ? 0.5 : 1 }}
                onClick={doCreateShare}
              >
                {sharing ? t('editor.generating') : t('editor.generate_link')}
              </View>
            </View>
          </View>
        </View>
      )}
      {historyOpen && (
        <View className="modal-mask" onClick={() => setHistoryOpen(false)}>
          <View className="modal-card" onClick={(e) => e.stopPropagation()}>
            <Text className="modal-title">{t('editor.history_title')}</Text>
            {historyLoading ? (
              <Text className="modal-text">{t('common.loading')}</Text>
            ) : versions.length === 0 ? (
              <Text className="modal-text">{t('editor.no_history')}</Text>
            ) : (
              <ScrollView scrollY style={{ maxHeight: '600rpx' }}>
                {versions.map((v) => (
                  <View key={v.id} className="device-item">
                    <View className="device-item-info">
                      <Text className="device-item-name">v{v.version}</Text>
                      <Text className="device-item-meta">
                        {new Date(v.createdAt).toLocaleString()}
                      </Text>
                    </View>
                    <Text className="mint-btn mint-btn-sm" onClick={() => void onRestoreVersion(v)}>
                      {t('common.restore')}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            )}
            <View className="row gap-m">
              <View
                className="mint-btn mint-btn-ghost flex-1"
                onClick={() => setHistoryOpen(false)}
              >
                {t('common.close')}
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
