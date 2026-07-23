/**
 * 小程序笔记编辑
 * 接入 E2EE：加载时解密显示，保存时加密后提交
 *
 * 功能：
 * - 自动保存（输入停止 1500ms 后触发）
 * - 顶栏置顶 / 收藏 / 删除图标按钮
 * - 保存状态指示器
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Input, Textarea } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { getApi, useAuthStore, decryptNote, encryptNote, parseEnvelope } from '../../state/auth';

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
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'unsaved';

export default function NoteEdit() {
  const instance = Taro.getCurrentInstance();
  const id = instance && instance.router && instance.router.params && instance.router.params.id;
  const masterKey = useAuthStore((s) => s.masterKey);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  // 保留原始 tags，保存时一起加密回去
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState<NoteData | null>(null);
  const noteRef = useRef(note);
  noteRef.current = note;
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  // 用于追踪是否已初始化加载，避免初始 load 触发自动保存
  const loadedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!id || !masterKey) return;
    void (async () => {
      try {
        const r = await getApi().get<{ notes: NoteData[] }>('/notes');
        const n = r.notes.find((x) => x.id === id);
        if (!n) {
          Taro.showToast({ title: '笔记不存在', icon: 'none' });
          return;
        }
        setNote(n);
        // 解析信封并解密明文
        try {
          const envelope = parseEnvelope(n.ciphertext);
          const pt = await decryptNote(masterKey, envelope);
          setTitle(pt.title);
          setContent(pt.content);
          setTags(pt.tags);
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
      const r = await getApi().patch<{ version: number; serverUpdatedAt: string }>(
        `/notes/${cur.id}`,
        {
          ciphertext: cipherJson,
          keyVersion: 1,
          isPinned: cur.isPinned,
          isFavorite: cur.isFavorite,
          clientUpdatedAt: new Date().toISOString(),
          version: cur.version,
        }
      );
      // 更新本地 version，防止下次保存用旧版本号导致 409 冲突
      setNote((prev) => (prev ? { ...prev, version: r.version } : prev));
      setSaveStatus('saved');
    } catch (err: any) {
      const status = err?.err?.status;
      if (status === 409) {
        Taro.showToast({ title: '版本冲突，请刷新后重试', icon: 'none' });
      } else {
        const msg = err?.err?.message || err?.message || '未知错误';
        console.error('[save]', err);
        Taro.showToast({ title: `保存失败：${msg}`, icon: 'none', duration: 3000 });
      }
      setSaveStatus('error');
    }
  }, [masterKey, title, content, tags]);

  // 用 ref 持有最新 save，避免 setTimeout 闭包拿到旧的 note/version
  const saveRef = useRef(save);
  saveRef.current = save;

  // 自动保存：title / content 变化且加载完成后，1500ms 防抖触发
  // 注意：不依赖 note，否则 save 成功后 note.version 更新会触发热重设为 unsaved
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
  }, [title, content]);

  const onManualSave = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await save();
  };

  const togglePinned = async () => {
    const cur = noteRef.current;
    if (!cur) return;
    const next = !cur.isPinned;
    const prevVer = cur.version;
    setNote({ ...cur, isPinned: next });
    try {
      const r = await getApi().patch<{ version: number }>(`/notes/${cur.id}`, {
        isPinned: next,
        clientUpdatedAt: new Date().toISOString(),
        version: prevVer,
      });
      setNote((p) => (p ? { ...p, version: r.version } : p));
      Taro.showToast({ title: next ? '已置顶' : '已取消置顶', icon: 'none' });
    } catch {
      setNote({ ...cur, isPinned: !next, version: prevVer });
      Taro.showToast({ title: '操作失败', icon: 'none' });
    }
  };

  const toggleFavorite = async () => {
    const cur = noteRef.current;
    if (!cur) return;
    const next = !cur.isFavorite;
    const prevVer = cur.version;
    setNote({ ...cur, isFavorite: next });
    try {
      const r = await getApi().patch<{ version: number }>(`/notes/${cur.id}`, {
        isFavorite: next,
        clientUpdatedAt: new Date().toISOString(),
        version: prevVer,
      });
      setNote((p) => (p ? { ...p, version: r.version } : p));
      Taro.showToast({ title: next ? '已收藏' : '已取消收藏', icon: 'none' });
    } catch {
      setNote({ ...cur, isFavorite: !next, version: prevVer });
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
      await getApi().delete(`/notes/${cur.id}`);
      Taro.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 500);
    } catch {
      Taro.showToast({ title: '删除失败', icon: 'none' });
    }
  };

  // 创建公开永久分享并复制链接到剪贴板
  const onShare = async () => {
    const cur = noteRef.current;
    if (!cur) return;
    try {
      const r = await getApi().post<{ token: string }>('/shares', {
        noteId: cur.id,
        title: title || '未命名笔记',
        content: content || '',
      });
      // H5: 完整可访问的页面链接；weapp: 分享页路径
      const shareUrl =
        process.env.TARO_ENV === 'h5'
          ? `http://localhost:10086/#/pages/share/index?token=${r.token}`
          : `/pages/share/index?token=${r.token}`;
      await Taro.setClipboardData({ data: shareUrl });
      Taro.showToast({ title: '分享链接已复制', icon: 'success' });
    } catch {
      Taro.showToast({ title: '分享失败', icon: 'none' });
    }
  };

  // 移动笔记到指定文件夹（或移出文件夹）
  const onMoveFolder = async () => {
    const cur = noteRef.current;
    if (!cur) return;
    let folders: Folder[] = [];
    try {
      const r = await getApi().get<{ folders: Folder[] }>('/folders');
      folders = r.folders;
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
      const r = await getApi().patch<{ version: number }>(`/notes/${cur.id}`, {
        folderId,
        clientUpdatedAt: new Date().toISOString(),
        version: cur.version,
      });
      setNote({ ...cur, folderId, version: r.version });
      Taro.showToast({ title: folderId ? `已移动到 ${folderName}` : '已移出文件夹', icon: 'none' });
    } catch {
      Taro.showToast({ title: '移动失败', icon: 'none' });
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
          <Text className="icon-btn" onClick={onShare}>
            🔗
          </Text>
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
        <Textarea
          className="mint-textarea flex-1"
          value={content}
          onInput={(e) => setContent((e.detail as { value: string }).value)}
          placeholder="开始记录…"
          autoHeight
        />
      </View>
    </View>
  );
}
