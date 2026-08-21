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
import Markdown from '../../lib/markdown';
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

/** 分享有效期选项（seconds：秒；0 = 永久） */
const SHARE_EXPIRY_OPTIONS = [
  { key: '1d', label: '1 天', seconds: 86400 },
  { key: '7d', label: '7 天', seconds: 604800 },
  { key: '30d', label: '30 天', seconds: 2592000 },
  { key: 'forever', label: '永久', seconds: 0 },
] as const;
type ShareExpiryKey = (typeof SHARE_EXPIRY_OPTIONS)[number]['key'];

export default function NoteEdit() {
  const instance = Taro.getCurrentInstance();
  const id = instance && instance.router && instance.router.params && instance.router.params.id;
  const masterKey = useAuthStore((s) => s.masterKey);
  const mode = useModeStore((s) => s.mode);
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
          Taro.showToast({ title: '笔记不存在', icon: 'none' });
          return;
        }
        setNote(n);
        // 解析信封并解密明文
        try {
          const envelope = parseEnvelope(n.ciphertext);
          const pt = await decryptNote(masterKey, envelope, noteAad(id, useAuthStore.getState().userId ?? ''));
          setTitle(pt.title);
          setContent(pt.content);
          setTags(pt.tags);
          // 记录 base 明文（三方合并的公共祖先）
          basePlainRef.current = { title: pt.title, content: pt.content, tags: pt.tags };
        } catch {
          setTitle('🔒 解密失败');
          setContent('');
        }
        loadedRef.current = true;
      } catch {
        Taro.showToast({ title: '加载失败', icon: 'none' });
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
        Taro.showToast({ title: '版本冲突，请刷新后重试', icon: 'none' });
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
          Taro.showToast({ title: '保存失败', icon: 'none', duration: 3000 });
          setSaveStatus('error');
        }
      } else {
        const msg = err?.err?.message || err?.message || '未知错误';
        console.error('[save]', err);
        Taro.showToast({ title: `保存失败：${msg}`, icon: 'none', duration: 3000 });
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
      Taro.showToast({ title: next ? '已置顶' : '已取消置顶', icon: 'none' });
    } catch {
      setNote({ ...cur, isPinned: !next });
      Taro.showToast({ title: '操作失败', icon: 'none' });
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
      Taro.showToast({ title: next ? '已收藏' : '已取消收藏', icon: 'none' });
    } catch {
      setNote({ ...cur, isFavorite: !next });
      Taro.showToast({ title: '操作失败', icon: 'none' });
    }
  };

  const onDelete = async () => {
    const cur = noteRef.current;
    if (!cur) return;
    const confirm = await Taro.showModal({
      title: '删除笔记',
      content: '确定删除该笔记？',
      confirmText: '删除',
      confirmColor: '#E07B6C',
    });
    if (!confirm.confirm) return;
    try {
      await getRepo().deleteNote(cur.id);
      Taro.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 500);
    } catch {
      Taro.showToast({ title: '删除失败', icon: 'none' });
    }
  };

  // 打开分享创建弹窗（仅联机模式）：可选密码 / 有效期
  const openShare = () => {
    const cur = noteRef.current;
    if (!cur) return;
    if (mode === 'standalone') {
      Taro.showToast({ title: '单机模式不支持在线分享，请使用导出', icon: 'none' });
      return;
    }
    if (!useAuthStore.getState().masterKey) {
      Taro.showToast({ title: '请先解锁', icon: 'none' });
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
      Taro.showToast({ title: '请先解锁', icon: 'none' });
      return;
    }
    const pwd = sharePwd.trim();
    if (pwd && (pwd.length < 4 || pwd.length > 64)) {
      Taro.showToast({ title: '密码需为 4-64 位', icon: 'none' });
      return;
    }
    const opt =
      SHARE_EXPIRY_OPTIONS.find((o) => o.key === shareExpiry) ?? SHARE_EXPIRY_OPTIONS[3]!;
    setSharing(true);
    try {
      // shareKey 只在本地生成，服务端只收到密文
      const shareKey = randomBytes(32);
      const ciphertext = await encryptString(
        shareKey,
        JSON.stringify({ title: title || '未命名笔记', content: content || '' })
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
      Taro.showToast({ title: '分享链接已复制', icon: 'success' });
    } catch (err: any) {
      const msg = err?.err?.message || err?.message || '未知错误';
      Taro.showToast({ title: `分享失败：${msg}`, icon: 'none', duration: 3000 });
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
      Taro.showToast({ title: '加载文件夹失败', icon: 'none' });
      return;
    }
    const itemList = ['未分类', ...folders.map((f) => f.name)];
    let tapIndex: number;
    try {
      const res = await Taro.showActionSheet({ itemList });
      tapIndex = res.tapIndex;
    } catch (err) {
      // 用户取消 showActionSheet 也会 throw，过滤掉
      const msg = (err as { errMsg?: string })?.errMsg ?? '';
      if (msg.includes('cancel')) return;
      Taro.showToast({ title: '操作失败', icon: 'none' });
      return;
    }
    let folderId: string | null = null;
    let folderName = '未分类';
    if (tapIndex > 0) {
      const f = folders[tapIndex - 1];
      folderId = f.id;
      folderName = f.name;
    }
    try {
      await getRepo().moveNote(cur.id, folderId);
      setNote({ ...cur, folderId });
      Taro.showToast({ title: folderId ? `已移动到 ${folderName}` : '已移出文件夹', icon: 'none' });
    } catch {
      Taro.showToast({ title: '移动失败', icon: 'none' });
    }
  };

  // ========== 历史版本（联机模式） ==========

  /** 打开历史版本弹窗并加载列表 */
  const openHistory = async () => {
    if (mode !== 'online') {
      Taro.showToast({ title: '单机模式不支持历史版本', icon: 'none' });
      return;
    }
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const r = await getApi().get<{ versions: NoteVersionMeta[] }>(
        `/notes/${id}/versions`
      );
      setVersions(r.versions ?? []);
    } catch {
      Taro.showToast({ title: '加载历史失败', icon: 'none' });
      setHistoryOpen(false);
    } finally {
      setHistoryLoading(false);
    }
  };

  /** 恢复指定历史版本：拉密文 → 解密 → 服务端 restore → 更新编辑器 */
  const onRestoreVersion = async (v: NoteVersionMeta) => {
    const confirm = await Taro.showModal({
      title: '恢复历史版本',
      content: `恢复到 v${v.version}（${new Date(v.createdAt).toLocaleString()}）？\n当前内容会先自动保存为一个新版本。`,
      confirmText: '恢复',
    });
    if (!confirm.confirm) return;
    try {
      if (!masterKey) throw new Error('未解锁');
      // 1. 拉取版本密文
      const r = await getApi().get<{ ciphertext: string }>(
        `/notes/${id}/versions/${v.id}`
      );
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
      Taro.showToast({ title: `已恢复到 v${v.version}`, icon: 'success' });
    } catch (err) {
      Taro.showToast({
        title: `恢复失败：${err instanceof Error ? err.message : '未知错误'}`,
        icon: 'none',
      });
    }
  };

  const statusText = (() => {
    switch (saveStatus) {
      case 'saving':
        return '🔄 保存中…';
      case 'saved':
        return '✅ 已保存';
      case 'error':
        return '⚠️ 保存失败';
      case 'unsaved':
        return '✏️ 未保存';
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
            {preview ? '编辑' : '预览'}
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
            保存
          </Text>
        </View>
      </View>

      <View className="editor-body">
        <Input
          className="mint-input-title"
          value={title}
          onInput={(e) => setTitle((e.detail as { value: string }).value)}
          placeholder="标题"
        />

        {preview ? (
          <ScrollView scrollY className="flex-1">
            <View className="md-preview">
              <Markdown content={content} />
            </View>
          </ScrollView>
        ) : (
          <Textarea
            className="mint-textarea flex-1"
            value={content}
            onInput={(e) => setContent((e.detail as { value: string }).value)}
            placeholder="开始记录…"
            autoHeight
          />
        )}
      </View>
      {shareOpen && (
        <View className="modal-mask" onClick={() => !sharing && setShareOpen(false)}>
          <View className="modal-card" onClick={(e) => e.stopPropagation()}>
            <Text className="modal-title">创建分享链接</Text>
            <Input
              className="mint-input"
              password
              placeholder="可选：设置访问密码（4-64 位）"
              value={sharePwd}
              onInput={(e) => setSharePwd((e.detail as { value: string }).value)}
            />
            <Text className="hint">有效期</Text>
            <View className="row gap-s mt-s mb-m">
              {SHARE_EXPIRY_OPTIONS.map((opt) => (
                <Text
                  key={opt.key}
                  className={`expiry-chip${shareExpiry === opt.key ? ' expiry-chip-active' : ''}`}
                  onClick={() => setShareExpiry(opt.key)}
                >
                  {opt.label}
                </Text>
              ))}
            </View>
            <View className="row gap-m">
              <View
                className="mint-btn mint-btn-ghost flex-1"
                onClick={() => !sharing && setShareOpen(false)}
              >
                取消
              </View>
              <View
                className="mint-btn flex-1"
                style={{ opacity: sharing ? 0.5 : 1 }}
                onClick={doCreateShare}
              >
                {sharing ? '生成中…' : '生成链接'}
              </View>
            </View>
          </View>
        </View>
      )}
      {historyOpen && (
        <View className="modal-mask" onClick={() => setHistoryOpen(false)}>
          <View className="modal-card" onClick={(e) => e.stopPropagation()}>
            <Text className="modal-title">历史版本</Text>
            {historyLoading ? (
              <Text className="modal-text">加载中…</Text>
            ) : versions.length === 0 ? (
              <Text className="modal-text">暂无历史版本</Text>
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
                    <Text
                      className="mint-btn mint-btn-sm"
                      onClick={() => void onRestoreVersion(v)}
                    >
                      恢复
                    </Text>
                  </View>
                ))}
              </ScrollView>
            )}
            <View className="row gap-m">
              <View className="mint-btn mint-btn-ghost flex-1" onClick={() => setHistoryOpen(false)}>
                关闭
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
