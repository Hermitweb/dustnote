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

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, Input, Image } from '@tarojs/components';
import logoUrl from '../../assets/logo.png';
import Taro, { useDidShow } from '@tarojs/taro';
import { ThemeVars, useThemeDarkClass } from '../../components/ThemeVars';
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
import { noteAad, PRESET_TEMPLATES, fillTemplatePlaceholders, encryptString, randomBytes, wrapKey, toBase64Url, type Template } from '@dustnote/shared';
import { randomUuid } from '../../lib/uuid';
import { getCachedPlain, putCachedPlain } from '../../lib/plain-cache';
import { PickSheet, type PickItem } from '../../components/PickSheet';
import { SearchIndex } from '../../lib/search-index';
import { t, useLanguage } from '../../lib/i18n';
import { parseServerDate } from '../../lib/date-parse';

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
  parentId?: string | null;
}

/** 筛选片展示用：文件夹根路径（父/子），同名子文件夹靠路径区分 */
function folderPathOf(f: Folder, all: Folder[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let cur: Folder | undefined = f;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = all.find((x) => x.id === cur!.parentId);
  }
  return parts.join('/');
}
type ViewMode = 'all' | 'favorite' | 'trash';

/** ThemeVars 必须在所有渲染分支(含锁定/加载早退分支)都挂载，
 * 否则导航栏颜色无人设置，darkmode 原生行为会让页头与应用主题脱钩 */
export default function Index() {
  return (
    <>
      <ThemeVars />
      <IndexBody />
    </>
  );
}

function IndexBody() {
  const authState = useAuthInit();
  const lock = useAuthStore((s) => s.lock);
  const unlock = useAuthStore((s) => s.unlock);
  const masterKey = useAuthStore((s) => s.masterKey);
  const mode = useModeStore((s) => s.mode);
  const modeInitialized = useModeStore((s) => s.initialized);
  const [notes, setNotes] = useState<Note[]>([]);
  const [plains, setPlains] = useState<Record<string, { title: string; content: string; tags?: string[] }>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const searchIndexRef = useRef(new SearchIndex());
  const [pickSheet, setPickSheet] = useState<Parameters<typeof PickSheet>[0] | null>(null);
  const darkClass = useThemeDarkClass();
  const [serverTemplates, setServerTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [unlockPwd, setUnlockPwd] = useState('');
  // Taro 受控 Input 的原生 placeholder 在聚焦且未输入时不消失，需逻辑层条件渲染
  const [pwdFocused, setPwdFocused] = useState(false);
  const [showTotp, setShowTotp] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lang = useLanguage();

  // 语言切换后同步原生导航栏标题
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('app.name') });
  }, [lang]);

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

  // 联机模式鉴权状态未就绪（unknown，如 init 未跑/网络失败）时重查，
  // 避免直接落到列表页出现“能看列表却无法操作”的中间态
  useEffect(() => {
    if (!modeInitialized || mode !== 'online' || authState !== 'unknown') return;
    const timer = setTimeout(() => {
      void useAuthStore.getState().init();
    }, 500);
    return () => clearTimeout(timer);
  }, [modeInitialized, mode, authState]);

  useEffect(() => {
    if (authState === 'unlocked' && masterKey) void load();
  }, [authState, masterKey]);
  // 离线队列重放成功后立即校正本地视图
  useEffect(() => {
    const handler = () => {
      if (useAuthStore.getState().authState === 'unlocked') void load();
    };
    Taro.eventCenter.on('dustnote:data-changed', handler);
    return () => {
      Taro.eventCenter.off('dustnote:data-changed', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
        const plainMap: Record<string, { title: string; content: string; tags?: string[] }> = {};
        for (const n of fresh.notes) {
          // 回收站笔记也纳入明文表(trash tab 标题显示 + 搜索可用);
          // 可见性由 visibleNotes 的 viewMode 过滤控制
          // 密文未变化的笔记直接命中缓存,跳过重复解密(治页面切换反复解密)
          const cached = getCachedPlain(n.id, n.ciphertext);
          if (cached) {
            plainMap[n.id] = { title: cached.title, content: cached.content, tags: cached.tags };
            continue;
          }
          try {
            const e = parseEnvelope(n.ciphertext);
            const pt = await decryptNote(
              masterKey,
              e,
              noteAad(n.id, useAuthStore.getState().userId ?? '')
            );
            // 保留 title + content：列表标题显示 + 全文搜索（v2.5.5 升级为标题+内容）
            putCachedPlain(n.id, n.ciphertext, pt.title, pt.content, pt.tags);
            plainMap[n.id] = { title: pt.title, content: pt.content, tags: pt.tags };
          } catch {
            plainMap[n.id] = { title: t('common.decrypt_failed'), content: '' };
          }
        }
        setPlains(plainMap);
        searchIndexRef.current.rebuild(plainMap);
        // 联机模式:拉服务端自定义模板(内容为密文,使用时解密)
        if (mode === 'online') {
          try {
            const r = await getApi().get<{ templates: Template[] }>('/templates');
            setServerTemplates((r.templates ?? []).filter((tp) => !tp.isPreset));
          } catch {
            /* 模板拉取失败不阻塞主流程 */
          }
        }
      }
    } catch {
      Taro.showToast({ title: t('common.load_failed'), icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  // ---------- 多选 ----------
  // 搜索排名(每次渲染最多算一次,避免逐笔记重复检索)
  const searchQueryTrimmed = searchQuery.trim();
  const searchRank = (() => {
    const rank = new Map<string, number>();
    if (!searchQueryTrimmed) return rank;
    searchIndexRef.current
      .search(searchQueryTrimmed)
      .forEach((hit, idx) => rank.set(hit.noteId, idx));
    return rank;
  })();
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
      if (activeTag && !(plains[n.id]?.tags ?? []).includes(activeTag)) return false;
      // 无搜索词时放行全部(2.5.34 搜索重构丢失此守卫导致列表恒空)
      if (!searchQueryTrimmed) return true;
      return searchRank.has(n.id);
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

  const pickFolderFromList = (folderList: Folder[]): Promise<string | null> =>
    new Promise((resolve) => {
      setPickSheet({
        title: t('index.pick_folder'),
        items: folderList.map((f) => ({ key: f.id, label: `📁 ${f.name}` })),
        onPick: (key) => resolve(key),
        onClose: () => resolve(null),
        cancelText: t('common.cancel'),
      });
    });

  const batchPatch = async (field: 'isPinned' | 'isFavorite', val: boolean) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const repo = getRepo();
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await repo.updateNote(id, { [field]: val } as any);
        ok++;
      } catch {
        fail++;
      }
    }
    const label = t(
      field === 'isPinned'
        ? val
          ? 'index.batch_pinned'
          : 'index.batch_unpinned'
        : val
          ? 'index.batch_favorited'
          : 'index.batch_unfavorited',
      { count: ok }
    );
    Taro.showToast({
      title: fail > 0 ? `${label}（${t('index.batch_failed', { count: fail })}）` : label,
      icon: fail > 0 ? 'none' : 'success',
    });
    exitSelect();
    await load();
  };

  // 行内分享：直接创建分享并复制链接（无密码/永久，进阶选项在编辑页分享弹窗）
  const shareFromList = async (n: Note) => {
    const mk = useAuthStore.getState().masterKey;
    if (!mk) {
      Taro.showToast({ title: t('common.need_unlock'), icon: 'none' });
      return;
    }
    if (mode !== 'online') {
      Taro.showToast({ title: t('editor.share_online_only'), icon: 'none' });
      return;
    }
    try {
      const shareKey = randomBytes(32);
      const pt = plains[n.id] ?? { title: '', content: '' };
      const ciphertext = await encryptString(shareKey, JSON.stringify({ title: pt.title, content: pt.content }));
      const wrappedShareKey = await wrapKey(mk, shareKey);
      const r = await getApi().post<{ token: string }>('/shares', {
        noteId: n.id,
        ciphertext,
        wrappedShareKey,
      });
      const key = toBase64Url(shareKey);
      // 与编辑页 doCreateShare 同构：weapp 复制浏览器可开的 https 链接
      const shareUrl = `${(useModeStore.getState().serverUrl ?? '').replace(/\/+$/, '')}/share/${r.token}#${key}`;
      await Taro.setClipboardData({ data: shareUrl });
      Taro.showToast({ title: t('editor.share_link_copied'), icon: 'success' });
    } catch (err: any) {
      const msg = err?.err?.message || err?.message || t('common.unknown_error');
      Taro.showToast({ title: t('editor.share_failed_msg', { msg }), icon: 'none', duration: 3000 });
    }
  };

  // 行内置顶切换
  const pinSingle = async (n: Note) => {
    try {
      await getRepo().updateNote(n.id, { isPinned: !n.isPinned } as any);
      await load();
    } catch {
      Taro.showToast({ title: t('common.save_failed'), icon: 'none' });
    }
  };

  const batchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const r = await Taro.showModal({
      title: t('index.delete_confirm_title'),
      content: t('index.delete_confirm_content', { count: ids.length }),
      confirmText: t('common.delete'),
      confirmColor: '#E07B6C',
    });
    if (!r.confirm) return;
    const repo = getRepo();
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await repo.deleteNote(id);
        ok++;
      } catch {
        fail++;
      }
    }
    Taro.showToast({ title: t('index.deleted_count', { count: ok }), icon: 'success' });
    exitSelect();
    await load();
  };

  const batchRestore = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const repo = getRepo();
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await repo.restoreNote(id);
        ok++;
      } catch {
        fail++;
      }
    }
    Taro.showToast({ title: t('index.restored_count', { count: ok }), icon: 'success' });
    exitSelect();
    await load();
  };

  const batchPermDelete = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const r = await Taro.showModal({
      title: t('common.perm_delete'),
      content: t('index.perm_delete_count_content', { count: ids.length }),
      confirmText: t('common.perm_delete'),
      confirmColor: '#E07B6C',
    });
    if (!r.confirm) return;
    const repo = getRepo();
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await repo.permanentDeleteNote(id);
        ok++;
      } catch {
        fail++;
      }
    }
    Taro.showToast({ title: t('index.perm_deleted_count', { count: ok }), icon: 'success' });
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
        Taro.showToast({ title: t('index.need_folder'), icon: 'none' });
        return;
      }
      const fid = await pickFolderFromList(folderList);
      if (!fid) return;
      const fname = folderList.find((f) => f.id === fid)!.name;
      let ok = 0;
    let fail = 0;
      for (const id of ids) {
        try {
          await repo.moveNote(id, fid);
          ok++;
        } catch {
          /* skip */
        }
      }
      Taro.showToast({
        title: t('index.moved_to_count', { name: fname, count: ok }),
        icon: 'success',
      });
      exitSelect();
      await load();
    } catch {
      Taro.showToast({ title: t('common.operation_failed'), icon: 'none' });
    }
  };

  // ---------- 单条操作（回收站） ----------
  const restoreSingle = async (n: Note) => {
    try {
      await getRepo().restoreNote(n.id);
      Taro.showToast({ title: t('common.restored'), icon: 'success' });
      await load();
    } catch {
      Taro.showToast({ title: t('common.restore_failed'), icon: 'none' });
    }
  };
  const permanentDeleteSingle = async (n: Note) => {
    const r = await Taro.showModal({
      title: t('common.perm_delete'),
      content: t('common.perm_delete_content'),
      confirmText: t('common.perm_delete'),
      confirmColor: '#E07B6C',
    });
    if (!r.confirm) return;
    try {
      await getRepo().permanentDeleteNote(n.id);
      Taro.showToast({ title: t('common.perm_deleted'), icon: 'success' });
      await load();
    } catch {
      Taro.showToast({ title: t('common.delete_failed'), icon: 'none' });
    }
  };

  const allTags = Array.from(new Set(Object.values(plains).flatMap((p) => p.tags ?? [])));
  const hasAll = visibleNotes.length > 0 && selectedIds.size === visibleNotes.length;
  const selCount = selectedIds.size;

  // 模式未选择：显示加载中（useEffect 会重定向）
  if (!modeInitialized) {
    return (
      <View className="hero">
        <Text className="hero-subtitle">{t('common.loading')}</Text>
      </View>
    );
  }

  // 单机模式未解锁：显示加载中（useEffect 会重定向到 standalone 页面）
  if (mode === 'standalone' && authState !== 'unlocked') {
    return (
      <View className="hero">
        <Text className="hero-subtitle">{t('common.loading')}</Text>
      </View>
    );
  }

  // 联机模式鉴权状态未就绪（unknown）：显示加载中并重查（上方 useEffect），
  // 不落入列表页造成“可看不可操作”的中间态
  if (mode === 'online' && authState === 'unknown') {
    return (
      <View className="hero">
        <Text className="hero-subtitle">{t('common.loading')}</Text>
      </View>
    );
  }

  // 联机模式未初始化：显示创建主密码按钮
  if (mode === 'online' && authState === 'uninitialized') {
    return (
      <View className="hero">
        <Image src={logoUrl} className="hero-logo" style={{ width: '64px', height: '64px' }} />
        <Text className="hero-title">{t('index.welcome')}</Text>
        <Text className="hero-subtitle">{t('index.hero_subtitle')}</Text>
        <View
          className="mint-btn mint-btn-block mt-l"
          onClick={() => Taro.navigateTo({ url: '/pages/setup/index' })}
        >
          {t('index.create_master_password')}
        </View>
      </View>
    );
  }

  // 联机模式需解锁：显示解锁表单
  if (mode === 'online' && authState === 'needs_unlock') {
    const doUnlock = async () => {
      if (!unlockPwd) {
        Taro.showToast({ title: t('common.pwd_empty'), icon: 'none' });
        return;
      }
      setUnlocking(true);
      try {
        await unlock(unlockPwd, showTotp ? totpCode : undefined);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        // 开启了两步验证的账号：解锁页追加 6 位验证码输入
        if (msg.includes('totp_required') || msg.includes('两步验证码')) {
          setShowTotp(true);
          Taro.showToast({ title: t('unlock.err_totp'), icon: 'none' });
        } else {
          Taro.showToast({ title: msg || t('common.unlock_failed'), icon: 'none' });
        }
      } finally {
        setUnlocking(false);
      }
    };
    return (
      <View className="hero">
        <Image src={logoUrl} className="hero-logo" style={{ width: '64px', height: '64px' }} />
        <Text className="hero-title">{t('app.name')}</Text>
        <Text className="hero-subtitle mb-l">{t('index.unlock_subtitle')}</Text>
        <Input
          className="mint-input"
          password
          placeholder={pwdFocused ? '' : t('common.master_password')}
          value={unlockPwd}
          onFocus={() => setPwdFocused(true)}
          onBlur={() => setPwdFocused(false)}
          onInput={(e: any) => setUnlockPwd((e.detail as { value: string }).value)}
        />
        {showTotp && (
          <Input
            className="mint-input mt-s"
            placeholder={t('unlock.totp_placeholder')}
            value={totpCode}
            onInput={(e: any) => setTotpCode((e.detail as { value: string }).value)}
          />
        )}
        <View
          className="mint-btn mint-btn-block mt-s"
          style={{ opacity: unlocking ? 0.5 : 1 }}
          onClick={doUnlock}
        >
          {unlocking ? t('common.unlocking') : t('common.unlock')}
        </View>
      </View>
    );
  }

  // 已解锁：显示主界面

  return (
    <>
      <View className={`page ${darkClass}`}>
      <View className="topbar">
        {selecting ? (
          <>
            <Text className="topbar-back" onClick={exitSelect}>
              ✕
            </Text>
            <Text className="topbar-title" onClick={toggleAll}>
              {hasAll
                ? t('common.deselect_all')
                : selCount
                  ? t('common.select_all_n', { count: selCount })
                  : t('common.select_all')}
            </Text>
            <View className="topbar-actions" />
          </>
        ) : (
          <>
            <Text className="topbar-title">{t('app.name')}</Text>
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
            placeholder={t('index.search_placeholder')}
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

      {!selecting && viewMode === 'all' && allTags.length > 0 && (
        <ScrollView scrollX className="folder-tabs" enhanced showScrollbar={false}>
          <View className="folder-tabs-inner">
            <Text
              className={`folder-chip${activeTag === null ? ' folder-chip-active' : ''}`}
              onClick={() => setActiveTag(null)}
            >
              {t('index.all_tags')}
            </Text>
            {allTags.map((tg) => (
              <Text
                key={tg}
                className={`folder-chip${activeTag === tg ? ' folder-chip-active' : ''}`}
                onClick={() => setActiveTag(activeTag === tg ? null : tg)}
              >
                #{tg}
              </Text>
            ))}
          </View>
        </ScrollView>
      )}
      {!selecting && viewMode === 'all' && folders.length > 0 && (
        <ScrollView scrollX className="folder-tabs" enhanced showScrollbar={false}>
          <View className="folder-tabs-inner">
            <Text
              className={`folder-chip${selectedFolderId === null ? ' folder-chip-active' : ''}`}
              onClick={() => setSelectedFolderId(null)}
            >
              {t('index.tab_all')}
            </Text>
            {folders.map((f) => (
              <Text
                key={f.id}
                className={`folder-chip${selectedFolderId === f.id ? ' folder-chip-active' : ''}`}
                onClick={() => setSelectedFolderId(f.id)}
              >
                {folderPathOf(f, folders)}
              </Text>
            ))}
          </View>
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
            {t('index.tab_all')}
          </Text>
          <Text
            className={`view-tab${viewMode === 'favorite' ? ' view-tab-active' : ''}`}
            onClick={() => {
              setViewMode('favorite');
              exitSelect();
            }}
          >
            {t('index.tab_favorite')}
          </Text>
          <Text
            className={`view-tab${viewMode === 'trash' ? ' view-tab-active' : ''}`}
            onClick={() => {
              setViewMode('trash');
              exitSelect();
            }}
          >
            {t('index.tab_trash')}
          </Text>
        </View>
      )}

      <ScrollView scrollY className="flex-1">
        {loading && <View className="loading">{t('common.loading')}</View>}
        {!loading && visibleNotes.length === 0 && (
          <View className="empty-state">
            <Text className="empty-state-icon">
              {viewMode === 'trash' ? '🗑️' : viewMode === 'favorite' ? '⭐' : '📝'}
            </Text>
            <Text className="empty-state-text">
              {viewMode === 'trash'
                ? t('index.empty_trash')
                : viewMode === 'favorite'
                  ? t('index.empty_favorite')
                  : t('index.empty_notes')}
            </Text>
          </View>
        )}
        {visibleNotes.map((n) => {
          const title = plains[n.id]?.title || t('common.unnamed_note');
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
                {parseServerDate(n.serverUpdatedAt).toLocaleString('zh-CN')}
              </Text>
              {!selecting && viewMode === 'trash' && (
                <View className="note-actions">
                  <Text
                    className="mint-btn mint-btn-sm mint-btn-ghost"
                    onClick={() => restoreSingle(n)}
                  >
                    {t('common.restore')}
                  </Text>
                  <Text
                    className="mint-btn mint-btn-sm mint-btn-danger"
                    onClick={() => permanentDeleteSingle(n)}
                  >
                    {t('common.perm_delete')}
                  </Text>
                </View>
              )}
              {!selecting && viewMode !== 'trash' && (
                <View className="note-actions">
                  <Text
                    className="mint-btn mint-btn-sm mint-btn-ghost"
                    onClick={() => void pinSingle(n)}
                  >
                    {n.isPinned ? `📌 ${t('index.unpin')}` : `📌 ${t('index.pin')}`}
                  </Text>
                  <Text
                    className="mint-btn mint-btn-sm mint-btn-ghost"
                    onClick={async () => {
                      try {
                        const repo = getRepo();
                        await repo.updateNote(n.id, { isFavorite: !n.isFavorite } as any);
                        await load();
                      } catch {
                        Taro.showToast({ title: t('common.save_failed'), icon: 'none' });
                      }
                    }}
                  >
                    {n.isFavorite ? `⭐ ${t('index.unfavorite')}` : `☆ ${t('index.favorite')}`}
                  </Text>
                  {mode === 'online' && (
                    <Text
                      className="mint-btn mint-btn-sm mint-btn-ghost"
                      onClick={() => void shareFromList(n)}
                    >
                      🔗 {t('index.share')}
                    </Text>
                  )}
                  <Text
                    className="mint-btn mint-btn-sm mint-btn-ghost"
                    onClick={() => {
                      setSelecting(true);
                      toggleSelect(n.id);
                    }}
                  >
                    {t('common.select')}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {selecting && (
        <View className="batch-bar">
          <Text className="batch-bar-count">{t('common.selected_count', { count: selCount })}</Text>
          <View className="batch-bar-actions">
            {viewMode !== 'trash' && (
              <>
                <Text className="batch-btn" onClick={batchMove}>
                  {t('index.batch_move')}
                </Text>
                <Text className="batch-btn" onClick={() => batchPatch('isPinned', true)}>
                  {t('index.batch_pin')}
                </Text>
                <Text className="batch-btn" onClick={() => batchPatch('isFavorite', true)}>
                  {t('index.batch_favorite')}
                </Text>
              </>
            )}
            {viewMode === 'trash' ? (
              <>
                <Text className="batch-btn" onClick={batchRestore}>
                  {t('index.batch_restore')}
                </Text>
                <Text className="batch-btn batch-btn-danger" onClick={batchPermDelete}>
                  {t('index.batch_perm_delete')}
                </Text>
              </>
            ) : (
              <Text className="batch-btn batch-btn-danger" onClick={batchDelete}>
                {t('index.batch_delete')}
              </Text>
            )}
          </View>
        </View>
      )}

      {!selecting && (
        <View
          className="fab-tpl"
          onClick={async () => {
            if (!masterKey) {
              Taro.showToast({ title: t('common.need_unlock'), icon: 'none' });
              return;
            }
            try {
              // 选模板:预设 + 服务端自定义(联机)
              const customItems = serverTemplates.map((tp) => ({ key: `c:${tp.id}`, label: `🗂 ${tp.name}` }));
              const presetItems = PRESET_TEMPLATES.map((tp, i) => ({ key: `p:${i}`, label: `${tp.icon} ${tp.name}` }));
              const pick = await new Promise<string | null>((resolve) => {
                setPickSheet({
                  title: t('index.pick_template'),
                  items: [...presetItems, ...customItems],
                  onPick: (key) => resolve(key),
                  onClose: () => resolve(null),
                  cancelText: t('common.cancel'),
                });
              });
              setPickSheet(null);
              if (!pick) return;
              let tplName = '';
              let content = '';
              if (pick.startsWith('p:')) {
                const tpl = PRESET_TEMPLATES[Number(pick.slice(2))]!;
                tplName = tpl.name;
                content = fillTemplatePlaceholders(tpl.content);
              } else {
                const ct = serverTemplates.find((tp) => `c:${tp.id}` === pick)!;
                tplName = ct.name;
                const env = parseEnvelope(ct.content);
                const pt = await decryptNote(masterKey, env);
                content = pt.content;
              }
              if (!tplName) return;
              // 选目标文件夹（与 FAB 新建一致的必选逻辑）
              let folderId: string | null = selectedFolderId;
              const folderList = folders as Folder[];
              if (folderId == null || !folderList.some((f) => f.id === folderId)) {
                if (folderList.length === 0) {
                  await ensureDefaultContent();
                  const fresh = (await getRepo().loadAll()).folders as Folder[];
                  if (fresh.length === 0) {
                    Taro.showToast({ title: t('index.need_folder'), icon: 'none' });
                    return;
                  }
                  folderId = fresh[0]!.id;
                } else {
                  folderId = await pickFolderFromList(folderList);
                  if (!folderId) return;
                }
              }
              const doc: NotePlaintext = { title: tplName, content, tags: [] };
              const noteId = randomUuid();
              const { json: cipherJson } = await encryptNote(
                masterKey,
                doc,
                noteAad(noteId, useAuthStore.getState().userId ?? ''),
              );
              const id = await getRepo().createNote({
                id: noteId,
                ciphertext: cipherJson,
                keyVersion: 1,
                isPinned: false,
                isFavorite: false,
                folderId,
              });
              Taro.navigateTo({ url: `/pages/note/edit?id=${id}` });
            } catch (e: any) {
              if (e?.errMsg?.includes?.('cancel')) return;
              Taro.showToast({ title: t('common.create_failed'), icon: 'none' });
            }
          }}
        >
          <Text>📄</Text>
        </View>
      )}

      {!selecting && (
        <View
          className="fab"
          onClick={async () => {
            if (!masterKey) {
              Taro.showToast({ title: t('common.need_unlock'), icon: 'none' });
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
                    Taro.showToast({ title: t('index.need_folder'), icon: 'none' });
                    return;
                  }
                  folderId = fresh[0]!.id;
                } else {
                  folderId = await pickFolderFromList(folderList);
                  if (!folderId) return;
                }
              }
              const empty: NotePlaintext = { title: t('index.new_note'), content: '', tags: [] };
              const noteId = randomUuid();
              const { json: cipherJson } = await encryptNote(
                masterKey,
                empty,
                noteAad(noteId, useAuthStore.getState().userId ?? ''),
              );
              const id = await getRepo().createNote({
                id: noteId,
                ciphertext: cipherJson,
                keyVersion: 1,
                isPinned: false,
                isFavorite: false,
                folderId,
              });
              Taro.navigateTo({ url: `/pages/note/edit?id=${id}` });
            } catch (e: any) {
              if (e?.errMsg?.includes?.('cancel')) return;
              Taro.showToast({ title: t('common.create_failed'), icon: 'none' });
            }
          }}
        >
          <Text>+</Text>
        </View>
      )}

      {/* pickFolderFromList / 模板选择的半屏弹层。此前从未挂载：setPickSheet 后
          Promise 永不 resolve，新建/模板/批量移动等依赖选文件夹的入口全部无响应 */}
      {pickSheet && <PickSheet {...pickSheet} />}
    </View>
    </>
  );
}
