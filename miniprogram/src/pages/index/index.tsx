/**
 * 小程序首页（笔记列表）
 *
 * v2.0.0 双模式架构：
 * - 数据访问统一通过 getRepo()（standalone → LocalRepository，online → RemoteRepository）
 * - 鉴权流程：
 *   - standalone 未设置 → 重定向到 standalone-setup
 *   - standalone 已设置未解锁 → 重定向到 standalone-unlock
 *   - online 未初始化 → 显示创建主密码按钮（跳转 setup）
 *   - online 需解锁 → 显示解锁表单
 *   - 已解锁 → 显示笔记列表
 *
 * 功能：多选批量操作、视图切换、文件夹筛选
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, Input, Image } from '@tarojs/components';
import logoUrl from '../../assets/logo.png';
import Taro, { useDidShow } from '@tarojs/taro';
import {
  getApi,
  useAuthStore,
  useAuthInit,
  decryptNote,
  encryptNote,
  parseEnvelope,
  type NotePlaintext,
} from '../../state/auth';
import { useModeStore } from '../../lib/mode-store';
import { getRepo } from '../../lib/get-repo';
import { ensureDefaultContent } from '../../lib/default-content';
import { noteAad } from '@dustnote/shared';

interface Note {
  id: string;
  ciphertext: string;
  keyVersion: number;
  isPinned: boolean;
  isFavorite: boolean;
  deletedAt: string | null;
  version: number;
  serverUpdatedAt: string;
  folderId: string | null;
}
interface Folder {
  id: string;
  name: string;
}
type ViewMode = 'all' | 'favorite' | 'trash';

export default function Index() {
  const authState = useAuthInit();
  const lock = useAuthStore((s) => s.lock);
  const unlock = useAuthStore((s) => s.unlock);
  const masterKey = useAuthStore((s) => s.masterKey);
  const mode = useModeStore((s) => s.mode);
  const modeInitialized = useModeStore((s) => s.initialized);
  const [notes, setNotes] = useState<Note[]>([]);
  const [plains, setPlains] = useState<Record<string, { title: string; content: string }>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [unlockPwd, setUnlockPwd] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 模式未选择时重定向到 mode-select
  useEffect(() => {
    if (!modeInitialized) {
      Taro.reLaunch({ url: '/pages/mode-select/index' });
    }
  }, [modeInitialized]);

  // 单机模式鉴权重定向
  useEffect(() => {
    if (!modeInitialized || mode !== 'standalone') return;
    if (authState === 'uninitialized') {
      Taro.reLaunch({ url: '/pages/standalone-setup/index' });
    } else if (authState === 'needs_unlock') {
      Taro.reLaunch({ url: '/pages/standalone-unlock/index' });
    }
  }, [modeInitialized, mode, authState]);

  useEffect(() => {
    if (authState === 'unlocked' && masterKey) void load();
  }, [authState, masterKey]);
  useDidShow(() => {
    if (authState === 'unlocked' && masterKey) void load();
  });

  const load = async () => {
    setLoading(true);
    try {
      const repo = getRepo();
      const snapshot = await repo.loadAll();
      // 首次使用初始化：默认文件夹 + 引导笔记 + 未分类迁移（幂等）
      await ensureDefaultContent();
      // 初始化可能新建/迁移了数据，重取最新快照
      const fresh = (snapshot.folders ?? []).length === 0 ? await repo.loadAll() : snapshot;
      setNotes(fresh.notes as Note[]);
      setFolders(fresh.folders as Folder[]);
      if (masterKey) {
        const t: Record<string, { title: string; content: string }> = {};
        for (const n of fresh.notes) {
          if (n.deletedAt) continue;
          try {
            const e = parseEnvelope(n.ciphertext);
            const pt = await decryptNote(
              masterKey,
              e,
              noteAad(n.id, useAuthStore.getState().userId ?? '')
            );
            // 保留 title + content：列表标题显示 + 全文搜索（v2.5.5 升级为标题+内容）
            t[n.id] = { title: pt.title, content: pt.content };
          } catch {
            t[n.id] = { title: '🔒 解密失败', content: '' };
          }
        }
        setPlains(t);
      }
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  // ---------- 多选 ----------
  const visibleNotes = notes
    .filter((n) => {
      if (viewMode === 'all') {
        if (n.deletedAt) return false;
        if (selectedFolderId !== null && n.folderId !== selectedFolderId) return false;
        return true;
      }
      if (viewMode === 'favorite') return n.isFavorite && !n.deletedAt;
      return !!n.deletedAt;
    })
    .filter((n) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      // 全文搜索：标题 + 内容（解密后的明文）
      const p = plains[n.id];
      return `${p?.title ?? ''}\n${p?.content ?? ''}`.toLowerCase().includes(q);
    })
    .sort((a, b) =>
      viewMode === 'trash'
        ? b.serverUpdatedAt.localeCompare(a.serverUpdatedAt)
        : a.isPinned === b.isPinned
          ? b.serverUpdatedAt.localeCompare(a.serverUpdatedAt)
          : a.isPinned
            ? -1
            : 1
    );

  const enterSelect = useCallback((id: string) => {
    setSelecting(true);
    setSelectedIds(new Set([id]));
  }, []);
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
  const toggleAll = useCallback(() => {
    if (selectedIds.size === visibleNotes.length) {
      setSelecting(false);
      setSelectedIds(new Set());
    } else setSelectedIds(new Set(visibleNotes.map((x) => x.id)));
  }, [selectedIds.size, visibleNotes]);

  const batchPatch = async (field: 'isPinned' | 'isFavorite', val: boolean) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const repo = getRepo();
    let ok = 0;
    for (const id of ids) {
      try {
        await repo.updateNote(id, { [field]: val } as any);
        ok++;
      } catch {
        /* skip */
      }
    }
    const label = field === 'isPinned' ? (val ? '置顶' : '取消置顶') : val ? '收藏' : '取消收藏';
    Taro.showToast({ title: `已${label} ${ok} 条`, icon: 'success' });
    exitSelect();
    await load();
  };

  const batchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const r = await Taro.showModal({
      title: '确认删除',
      content: `确定删除选中的 ${ids.length} 条笔记？`,
      confirmText: '删除',
      confirmColor: '#E07B6C',
    });
    if (!r.confirm) return;
    const repo = getRepo();
    let ok = 0;
    for (const id of ids) {
      try {
        await repo.deleteNote(id);
        ok++;
      } catch {
        /* skip */
      }
    }
    Taro.showToast({ title: `已删除 ${ok} 条`, icon: 'success' });
    exitSelect();
    await load();
  };

  const batchRestore = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const repo = getRepo();
    let ok = 0;
    for (const id of ids) {
      try {
        await repo.restoreNote(id);
        ok++;
      } catch {
        /* skip */
      }
    }
    Taro.showToast({ title: `已恢复 ${ok} 条`, icon: 'success' });
    exitSelect();
    await load();
  };

  const batchPermDelete = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const r = await Taro.showModal({
      title: '永久删除',
      content: `该操作不可恢复，确定永久删除 ${ids.length} 条笔记？`,
      confirmText: '永久删除',
      confirmColor: '#E07B6C',
    });
    if (!r.confirm) return;
    const repo = getRepo();
    let ok = 0;
    for (const id of ids) {
      try {
        await repo.permanentDeleteNote(id);
        ok++;
      } catch {
        /* skip */
      }
    }
    Taro.showToast({ title: `已永久删除 ${ok} 条`, icon: 'success' });
    exitSelect();
    await load();
  };

  const batchMove = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      const repo = getRepo();
      const snapshot = await repo.loadAll();
      const folderList = snapshot.folders as Folder[];
      if (folderList.length === 0) {
        Taro.showToast({ title: '请先创建文件夹', icon: 'none' });
        return;
      }
      const itemList = folderList.map((f) => f.name);
      let ti: number;
      try {
        const res = await Taro.showActionSheet({ itemList });
        ti = res.tapIndex;
      } catch (e: any) {
        if (e?.errMsg?.includes?.('cancel')) return;
        throw e;
      }
      const fid = folderList[ti]!.id;
      const fname = folderList[ti]!.name;
      let ok = 0;
      for (const id of ids) {
        try {
          await repo.moveNote(id, fid);
          ok++;
        } catch {
          /* skip */
        }
      }
      Taro.showToast({ title: `已移动到 ${fname} (${ok} 条)`, icon: 'success' });
      exitSelect();
      await load();
    } catch {
      Taro.showToast({ title: '操作失败', icon: 'none' });
    }
  };

  // ---------- 单条操作（回收站） ----------
  const restoreSingle = async (n: Note) => {
    try {
      await getRepo().restoreNote(n.id);
      Taro.showToast({ title: '已恢复', icon: 'success' });
      await load();
    } catch {
      Taro.showToast({ title: '恢复失败', icon: 'none' });
    }
  };
  const permanentDeleteSingle = async (n: Note) => {
    const r = await Taro.showModal({
      title: '永久删除',
      content: '该操作不可恢复，确定永久删除？',
      confirmText: '永久删除',
      confirmColor: '#E07B6C',
    });
    if (!r.confirm) return;
    try {
      await getRepo().permanentDeleteNote(n.id);
      Taro.showToast({ title: '已永久删除', icon: 'success' });
      await load();
    } catch {
      Taro.showToast({ title: '删除失败', icon: 'none' });
    }
  };

  const hasAll = visibleNotes.length > 0 && selectedIds.size === visibleNotes.length;
  const selCount = selectedIds.size;

  // 模式未选择：显示加载中（useEffect 会重定向）
  if (!modeInitialized) {
    return (
      <View className="hero">
        <Text className="hero-subtitle">加载中…</Text>
      </View>
    );
  }

  // 单机模式未解锁：显示加载中（useEffect 会重定向到 standalone 页面）
  if (mode === 'standalone' && authState !== 'unlocked') {
    return (
      <View className="hero">
        <Text className="hero-subtitle">加载中…</Text>
      </View>
    );
  }

  // 联机模式未初始化：显示创建主密码按钮
  if (mode === 'online' && authState === 'uninitialized') {
    return (
      <View className="hero">
        <Image src={logoUrl} className="hero-logo" style={{ width: '64px', height: '64px' }} />
        <Text className="hero-title">欢迎使用 DustNote</Text>
        <Text className="hero-subtitle">端到端加密 · 私密笔记</Text>
        <View
          className="mint-btn mint-btn-block mt-l"
          onClick={() => Taro.navigateTo({ url: '/pages/setup/index' })}
        >
          创建主密码
        </View>
      </View>
    );
  }

  // 联机模式需解锁：显示解锁表单
  if (mode === 'online' && authState === 'needs_unlock') {
    const doUnlock = async () => {
      if (!unlockPwd) {
        Taro.showToast({ title: '请输入主密码', icon: 'none' });
        return;
      }
      setUnlocking(true);
      try {
        await unlock(unlockPwd);
      } catch (err) {
        Taro.showToast({ title: err instanceof Error ? err.message : '解锁失败', icon: 'none' });
      } finally {
        setUnlocking(false);
      }
    };
    return (
      <View className="hero">
        <Image src={logoUrl} className="hero-logo" style={{ width: '64px', height: '64px' }} />
        <Text className="hero-title">DustNote</Text>
        <Text className="hero-subtitle mb-l">输入主密码解锁</Text>
        <Input
          className="mint-input"
          password
          placeholder="主密码"
          value={unlockPwd}
          onInput={(e: any) => setUnlockPwd((e.detail as { value: string }).value)}
        />
        <View
          className="mint-btn mint-btn-block mt-s"
          style={{ opacity: unlocking ? 0.5 : 1 }}
          onClick={doUnlock}
        >
          {unlocking ? '解锁中…' : '解锁'}
        </View>
      </View>
    );
  }

  // 已解锁：显示主界面
  return (
    <View className="page">
      <View className="topbar">
        {selecting ? (
          <>
            <Text className="topbar-back" onClick={exitSelect}>
              ✕
            </Text>
            <Text className="topbar-title" onClick={toggleAll}>
              {hasAll ? '取消全选' : `全选 ${selCount ? `(${selCount})` : ''}`}
            </Text>
            <View className="topbar-actions" />
          </>
        ) : (
          <>
            <Text className="topbar-title">DustNote</Text>
            <View className="topbar-actions">
              <Text
                className="icon-btn"
                onClick={() => Taro.navigateTo({ url: '/pages/settings/index' })}
              >
                ⚙️
              </Text>
              <Text className="icon-btn" onClick={() => lock()}>
                🔒
              </Text>
            </View>
          </>
        )}
      </View>

      {!selecting && (
        <View className="search-box">
          <Input
            className="search-input"
            placeholder="搜索笔记"
            value={searchQuery}
            onInput={(e) => setSearchQuery((e.detail as { value: string }).value)}
          />
          {searchQuery ? (
            <Text className="search-clear" onClick={() => setSearchQuery('')}>
              ✕
            </Text>
          ) : null}
        </View>
      )}

      {!selecting && viewMode === 'all' && folders.length > 0 && (
        <ScrollView scrollX className="folder-tabs" enhanced showScrollbar={false}>
          <Text
            className={`folder-chip${selectedFolderId === null ? ' folder-chip-active' : ''}`}
            onClick={() => setSelectedFolderId(null)}
          >
            全部
          </Text>
          {folders.map((f) => (
            <Text
              key={f.id}
              className={`folder-chip${selectedFolderId === f.id ? ' folder-chip-active' : ''}`}
              onClick={() => setSelectedFolderId(f.id)}
            >
              {f.name}
            </Text>
          ))}
        </ScrollView>
      )}

      {!selecting && (
        <View className="view-tabs">
          <Text
            className={`view-tab${viewMode === 'all' ? ' view-tab-active' : ''}`}
            onClick={() => {
              setViewMode('all');
              exitSelect();
            }}
          >
            全部
          </Text>
          <Text
            className={`view-tab${viewMode === 'favorite' ? ' view-tab-active' : ''}`}
            onClick={() => {
              setViewMode('favorite');
              exitSelect();
            }}
          >
            收藏
          </Text>
          <Text
            className={`view-tab${viewMode === 'trash' ? ' view-tab-active' : ''}`}
            onClick={() => {
              setViewMode('trash');
              exitSelect();
            }}
          >
            回收站
          </Text>
        </View>
      )}

      <ScrollView scrollY className="flex-1">
        {loading && <View className="loading">加载中…</View>}
        {!loading && visibleNotes.length === 0 && (
          <View className="empty-state">
            <Text className="empty-state-icon">
              {viewMode === 'trash' ? '🗑️' : viewMode === 'favorite' ? '⭐' : '📝'}
            </Text>
            <Text className="empty-state-text">
              {viewMode === 'trash'
                ? '回收站为空'
                : viewMode === 'favorite'
                  ? '还没有收藏笔记'
                  : '还没有笔记'}
            </Text>
          </View>
        )}
        {visibleNotes.map((n) => {
          const title = plains[n.id]?.title || '🌿 未命名笔记';
          const checked = selectedIds.has(n.id);
          return (
            <View
              key={n.id}
              className={`note-row${selecting ? ' select-mode' : ''}${checked ? ' note-row-checked' : ''}`}
            >
              <View className="note-row-head">
                {selecting && (
                  <View
                    className={`checkbox${checked ? ' checkbox-checked' : ''}`}
                    onClick={() => toggleSelect(n.id)}
                  >
                    {checked && <Text className="checkbox-mark">✓</Text>}
                  </View>
                )}
                <View className="note-icons">
                  {n.isPinned ? <Text>📌</Text> : null}
                  {n.isFavorite ? <Text>⭐</Text> : null}
                </View>
                <Text
                  className="note-title"
                  onClick={() =>
                    selecting
                      ? toggleSelect(n.id)
                      : Taro.navigateTo({ url: `/pages/note/edit?id=${n.id}` })
                  }
                  onLongPress={() => {
                    if (!selecting) enterSelect(n.id);
                  }}
                >
                  {title}
                </Text>
              </View>
              <Text className="note-meta">
                {new Date(n.serverUpdatedAt).toLocaleString('zh-CN')}
              </Text>
              {!selecting && viewMode === 'trash' && (
                <View className="note-actions">
                  <Text
                    className="mint-btn mint-btn-sm mint-btn-ghost"
                    onClick={() => restoreSingle(n)}
                  >
                    恢复
                  </Text>
                  <Text
                    className="mint-btn mint-btn-sm mint-btn-danger"
                    onClick={() => permanentDeleteSingle(n)}
                  >
                    永久删除
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {selecting && (
        <View className="batch-bar">
          <Text className="batch-bar-count">已选 {selCount} 项</Text>
          <View className="batch-bar-actions">
            {viewMode !== 'trash' && (
              <>
                <Text className="batch-btn" onClick={batchMove}>
                  📁 移动
                </Text>
                <Text className="batch-btn" onClick={() => batchPatch('isPinned', true)}>
                  📌 置顶
                </Text>
                <Text className="batch-btn" onClick={() => batchPatch('isFavorite', true)}>
                  ⭐ 收藏
                </Text>
              </>
            )}
            {viewMode === 'trash' ? (
              <>
                <Text className="batch-btn" onClick={batchRestore}>
                  ↩ 恢复
                </Text>
                <Text className="batch-btn batch-btn-danger" onClick={batchPermDelete}>
                  🗑️ 彻底删除
                </Text>
              </>
            ) : (
              <Text className="batch-btn batch-btn-danger" onClick={batchDelete}>
                🗑️ 删除
              </Text>
            )}
          </View>
        </View>
      )}

      {!selecting && (
        <View
          className="fab"
          onClick={async () => {
            if (!masterKey) {
              Taro.showToast({ title: '请先解锁', icon: 'none' });
              return;
            }
            try {
              // 笔记必须归属文件夹：选中文件夹直接用；否则 ActionSheet 必选
              let folderId: string | null = selectedFolderId;
              const folderList = folders as Folder[];
              if (folderId == null || !folderList.some((f) => f.id === folderId)) {
                if (folderList.length === 0) {
                  await ensureDefaultContent();
                  const fresh = (await getRepo().loadAll()).folders as Folder[];
                  if (fresh.length === 0) {
                    Taro.showToast({ title: '请先创建文件夹', icon: 'none' });
                    return;
                  }
                  folderId = fresh[0]!.id;
                } else {
                  const res = await Taro.showActionSheet({
                    itemList: folderList.map((f) => f.name),
                  });
                  folderId = folderList[res.tapIndex]!.id;
                }
              }
              const empty: NotePlaintext = { title: '新笔记', content: '', tags: [] };
              const { json: cipherJson } = await encryptNote(masterKey, empty);
              const id = await getRepo().createNote({
                ciphertext: cipherJson,
                keyVersion: 1,
                isPinned: false,
                isFavorite: false,
                folderId,
              });
              Taro.navigateTo({ url: `/pages/note/edit?id=${id}` });
            } catch (e: any) {
              if (e?.errMsg?.includes?.('cancel')) return;
              Taro.showToast({ title: '创建失败', icon: 'none' });
            }
          }}
        >
          <Text>+</Text>
        </View>
      )}
    </View>
  );
}
