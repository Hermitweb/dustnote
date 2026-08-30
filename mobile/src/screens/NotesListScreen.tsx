/**
 * 笔记列表：左侧抽屉 + 主区卡片列表
 *
 * 移动端使用底部 Tab + 顶部搜索
 *
 * v2.0.0 双模式架构：通过 createRepository 工厂按模式分流
 * - standalone → LocalRepository（AsyncStorage）
 * - online     → RemoteRepository（封装 api）
 *
 * 不再直接调用 api.get/post，避免单机模式下因无服务端而崩溃
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  TextInput,
  Alert,
  ScrollView,
  Modal,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';
import { noteAad, type NoteRow, type Folder } from '@dustnote/shared';
import { useAuthStore } from '../state/auth';
import { useModeStore } from '../lib/mode-store';
import { createRepository } from '../lib/repository';
import { enqueueOffline, flushOfflineQueue, isNetworkError } from '../lib/offline-queue';
import { decryptNote, packEnvelope } from '../lib/envelope';
import { ensureDefaultContent } from '../lib/default-content';
import { useColors } from '../theme';
import { useResponsiveLayout } from '../lib/useResponsiveLayout';

interface NotePlaintext {
  title: string;
  content: string;
  tags: string[];
}

interface NoteListItem extends NoteRow {
  plain: NotePlaintext | null;
}

export function NotesListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const colors = useColors();
  const layout = useResponsiveLayout();
  const masterKey = useAuthStore((s) => s.masterKey);
  const mode = useModeStore((s) => s.mode);
  const modeInitialized = useModeStore((s) => s.initialized);
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  // 筛选（排序分类 UI 已移除，固定按更新时间倒序）
  const [tab, setTab] = useState<'all' | 'fav'>('all');
  const [folderFilter, setFolderFilter] = useState<string>('all'); // 'all' | folderId
  const [folders, setFolders] = useState<Folder[]>([]);
  // 批量操作：长按笔记进入多选，底部操作栏支持全选/移动/删除
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  // 创建 Repository（按当前模式分流）
  // mode 可能因 hydrated 延迟而短暂为 null，使用 ?? 'online' 兜底避免类型错误
  const repo = useMemo(
    () =>
      createRepository({
        mode: mode ?? 'online',
        serverUrl: null,
        accessToken: null,
        deviceId: null,
      }),
    [mode]
  );

  const load = useCallback(async () => {
    if (!modeInitialized) return;
    setRefreshing(true);
    setError(null);
    try {
      const snapshot = await repo.loadAll();
      // 首次使用初始化：默认文件夹 + 引导笔记 + 未分类迁移（幂等）
      await ensureDefaultContent(repo, masterKey, snapshot);
      // 在主线程逐条解密（v1 简化；后续可放到 worker）
      const withPlain: NoteListItem[] = [];
      for (const n of snapshot.notes) {
        let plain: NotePlaintext | null = null;
        if (masterKey) {
          try {
            plain = await decryptNote(
              masterKey,
              n.ciphertext,
              noteAad(n.id, useAuthStore.getState().userId ?? '')
            );
          } catch {
            plain = { title: '🔒 解密失败', content: '', tags: [] };
          }
        }
        withPlain.push({ ...n, plain });
      }
      setNotes(withPlain);
      setFolders(snapshot.folders ?? []);
      // 网络已恢复（loadAll 成功）：重放离线队列中的未同步修改
      if (mode === 'online') {
        void flushOfflineQueue();
      }
    } catch (err) {
      console.warn('加载失败', err);
      setError(`加载失败：${(err as Error).message}。下拉可重试。`);
    } finally {
      setRefreshing(false);
    }
  }, [masterKey, repo, modeInitialized, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  // 从 NoteEditScreen 返回（屏幕重新聚焦）时重新加载，确保标题修改后列表立即更新
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return notes
      .filter((n) => !n.deletedAt)
      .filter((n) => (tab === 'fav' ? !!n.isFavorite : true))
      .filter((n) => {
        if (folderFilter === 'all') return true;
        return n.folderId === folderFilter;
      })
      .filter((n) => {
        if (!keyword) return true;
        // 搜索标题 + 内容（解密后的明文）
        const title = n.plain?.title?.toLowerCase() ?? '';
        const content = n.plain?.content?.toLowerCase() ?? '';
        return title.includes(keyword) || content.includes(keyword);
      })
      .sort((a, b) => {
        // 置顶优先；排序分类 UI 已移除，固定按更新时间倒序
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return b.serverUpdatedAt.localeCompare(a.serverUpdatedAt);
      });
  }, [notes, search, tab, folderFilter]);

  // 文件夹层级导航（路径式下钻）：面包屑链 + 当前层子文件夹
  const folderMap = useMemo(() => {
    const m = new Map<string, Folder>();
    for (const f of folders) m.set(f.id, f);
    return m;
  }, [folders]);
  const crumbs = useMemo(() => {
    const chain: Folder[] = [];
    let cur = folderFilter !== 'all' ? folderMap.get(folderFilter) : undefined;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parentId ? folderMap.get(cur.parentId) : undefined;
    }
    return chain;
  }, [folderFilter, folderMap]);
  const subFolders = useMemo(() => {
    const parentId = folderFilter === 'all' ? null : folderFilter;
    return folders.filter((f) => f.parentId === parentId);
  }, [folders, folderFilter]);

  // ── 批量操作 ──────────────────────────────────────────────
  const exitSelect = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);
  const enterSelect = useCallback((id: string) => {
    setSelecting(true);
    setSelectedIds(new Set([id]));
  }, []);
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === filtered.length && filtered.length > 0 ? new Set() : new Set(filtered.map((n) => n.id))
    );
  }, [filtered]);

  const doBatchMove = useCallback(
    async (folderId: string | null) => {
      setMoveModalVisible(false);
      if (selectedIds.size === 0 || busy) return;
      setBusy(true);
      let ok = 0;
      let fail = 0;
      for (const id of selectedIds) {
        try {
          await repo.moveNote(id, folderId);
          ok++;
        } catch {
          fail++;
        }
      }
      setBusy(false);
      exitSelect();
      await load();
      Alert.alert('移动完成', `成功移动 ${ok} 篇${fail > 0 ? `，失败 ${fail} 篇` : ''}`);
    },
    [selectedIds, busy, repo, exitSelect, load]
  );

  const doBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0 || busy) return;
    setBusy(true);
    let ok = 0;
    let fail = 0;
    for (const id of selectedIds) {
      try {
        await repo.deleteNote(id); // 软删除 → 进回收站
        ok++;
      } catch {
        fail++;
      }
    }
    setBusy(false);
    exitSelect();
    await load();
    Alert.alert('删除完成', `已把 ${ok} 篇笔记移入回收站${fail > 0 ? `，失败 ${fail} 篇` : ''}`);
  }, [selectedIds, busy, repo, exitSelect, load]);

  const confirmBatchDelete = useCallback(() => {
    const n = selectedIds.size;
    if (n === 0) return;
    Alert.alert('批量删除', `确定把选中的 ${n} 篇笔记移入回收站吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void doBatchDelete() },
    ]);
  }, [selectedIds, doBatchDelete]);

  const styles = makeStyles(colors, layout);

  return (
    <View style={styles.container}>
      {/* 顶部搜索栏 + 快捷入口 */}
      <View
        style={[
          styles.searchBar,
          layout.isTablet && {
            maxWidth: layout.maxContentWidth,
            alignSelf: 'center',
            width: '100%',
          },
        ]}
      >
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 搜索笔记…"
          value={search}
          onChangeText={setSearch}
          placeholderTextColor={colors.muted}
        />
        <TouchableOpacity onPress={() => navigation.navigate('Folders')} style={styles.iconButton}>
          <Text style={styles.iconText}>📁</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Trash')} style={styles.iconButton}>
          <Text style={styles.iconText}>🗑️</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.iconButton}>
          <Text style={styles.iconText}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* 筛选栏（"全部/收藏"切换已移至底部按钮区；笔记按更新时间排序） */}
      <View style={styles.filterBar}>
        {/* 文件夹层级导航（路径式下钻）：面包屑 + 当前层子文件夹 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.folderRow}>
          <FilterChip
            label="🏠 全部"
            active={folderFilter === 'all'}
            onPress={() => setFolderFilter('all')}
            colors={colors}
          />
          {crumbs.map((c) => (
            <FilterChip
              key={c.id}
              label={`▸ ${c.name}`}
              active={folderFilter === c.id}
              onPress={() => setFolderFilter(c.id)}
              colors={colors}
            />
          ))}
        </ScrollView>
        {/* 当前层的子文件夹（点击下钻） */}
        {subFolders.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.folderRow}>
            {subFolders.map((f) => (
              <FilterChip
                key={f.id}
                label={`📁 ${f.name}`}
                active={false}
                onPress={() => setFolderFilter(f.id)}
                colors={colors}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {/* 笔记列表 */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}
        ListEmptyComponent={
          error ? (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>⚠️</Text>
              <Text style={styles.emptyText}>{error}</Text>
              <TouchableOpacity onPress={() => void load()} style={styles.retryBtn}>
                <Text style={styles.retryText}>重试</Text>
              </TouchableOpacity>
            </View>
          ) : folderFilter === 'all' && tab === 'all' ? (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>📁</Text>
              <Text style={styles.emptyText}>笔记按文件夹归类</Text>
              <Text style={styles.emptyHint}>在上方进入一个文件夹，即可查看其中的笔记</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>📝</Text>
              <Text style={styles.emptyText}>这个文件夹还没有笔记</Text>
              <Text style={styles.emptyHint}>点击右下角按钮创建第一篇</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, selecting && selectedIds.has(item.id) && styles.cardSelected]}
            onPress={() => {
              if (selecting) {
                toggleSelect(item.id);
                return;
              }
              navigation.navigate('NoteEdit', { noteId: item.id });
            }}
            onLongPress={() => {
              if (!selecting) enterSelect(item.id);
            }}
            delayLongPress={350}
          >
            <View style={styles.cardHeader}>
              {selecting ? (
                <Text style={styles.checkMark}>{selectedIds.has(item.id) ? '☑' : '☐'}</Text>
              ) : null}
              {item.isPinned ? <Text style={styles.pin}>📌</Text> : null}
              {item.isFavorite ? <Text style={styles.fav}>⭐</Text> : null}
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.plain?.title ?? '🔒'}
              </Text>
            </View>
            <Text style={styles.cardMeta}>
              {new Date(item.serverUpdatedAt).toLocaleString('zh-CN')}
            </Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={{
          paddingBottom: selecting ? 130 : 80,
          // 平板：限制内容宽度并居中，提升阅读体验
          ...(layout.isTablet
            ? { maxWidth: layout.maxContentWidth, alignSelf: 'center', width: '100%' }
            : {}),
        }}
      />

      {/* 收藏切换 + 新建按钮（多选模式下隐藏，让位给批量操作栏） */}
      {!selecting && (
        <>
          <TouchableOpacity
            style={[styles.fabLike, tab === 'fav' && { backgroundColor: colors.mint600 }]}
            onPress={() => setTab(tab === 'fav' ? 'all' : 'fav')}
          >
            <Text style={[styles.fabLikeText, tab === 'fav' && { color: '#fff' }]}>
              ⭐ {tab === 'fav' ? '查看全部' : '收藏'}
            </Text>
          </TouchableOpacity>
          {/* 新建按钮 */}
          <TouchableOpacity
            style={styles.fab}
            onPress={async () => {
          if (!masterKey) return;
          // 笔记必须归属文件夹：「全部」视图未选中文件夹时不创建
          if (folderFilter === 'all') {
            Alert.alert('提示', '请先在顶部选择一个文件夹，再创建笔记。');
            return;
          }
          try {
            // 用真实密文创建空笔记，保证列表展示与其他端一致
            const empty: NotePlaintext = { title: '新笔记', content: '', tags: [] };
            const ciphertext = await packEnvelope(masterKey, empty);
            // 当前选中文件夹 → 新笔记归属该文件夹
            const targetFolderId = folderFilter;
            const newId = await repo.createNote({
              ciphertext,
              keyVersion: 1,
              isPinned: false,
              isFavorite: false,
              folderId: targetFolderId,
            });
            // 创建后直接进入编辑器（与 Web 端行为一致）；否则只刷列表、
            // 用户面对一篇没有打开的空笔记（真机实测反馈）
            navigation.navigate('NoteEdit', { noteId: newId });
          } catch (err) {
            // 联机模式网络不可用：入队待同步（离线队列简化版）
            if (mode === 'online' && isNetworkError(err)) {
              try {
                const empty: NotePlaintext = { title: '新笔记', content: '', tags: [] };
                const ciphertext = await packEnvelope(masterKey, empty);
                const targetFolderId = folderFilter !== 'all' ? folderFilter : null;
                await enqueueOffline('POST', '/notes', {
                  ciphertext,
                  keyVersion: 1,
                  isPinned: false,
                  isFavorite: false,
                  clientUpdatedAt: new Date().toISOString(),
                  folderId: targetFolderId,
                });
                Alert.alert('已离线', '笔记已加入离线队列，联网后自动同步。');
              } catch {
                Alert.alert('创建失败', (err as Error).message);
              }
            } else {
              console.warn('创建失败', err);
              Alert.alert('创建失败', (err as Error).message);
            }
          }
        }}
      >
        <Text style={styles.fabText}>+</Text>
          </TouchableOpacity>
        </>
      )}

      {/* 批量操作栏（多选模式下显示） */}
      {selecting && (
        <View style={styles.batchBar}>
          <TouchableOpacity style={styles.batchBtn} onPress={toggleSelectAll}>
            <Text style={styles.batchBtnText}>
              {selectedIds.size === filtered.length && filtered.length > 0 ? '取消全选' : '全选'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.batchBtn}
            disabled={selectedIds.size === 0 || busy}
            onPress={() => setMoveModalVisible(true)}
          >
            <Text style={[styles.batchBtnText, styles.batchBtnTextStrong]} numberOfLines={1}>
              移动 ({selectedIds.size})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.batchBtn}
            disabled={selectedIds.size === 0 || busy}
            onPress={confirmBatchDelete}
          >
            <Text style={[styles.batchBtnText, styles.batchBtnTextDanger]} numberOfLines={1}>
              删除 ({selectedIds.size})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.batchBtn} onPress={exitSelect}>
            <Text style={styles.batchBtnText}>取消</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 移动到文件夹弹层 */}
      <Modal
        visible={moveModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMoveModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>移动 {selectedIds.size} 篇笔记到…</Text>
            <ScrollView style={styles.modalList}>
              <TouchableOpacity style={styles.modalItem} onPress={() => void doBatchMove(null)}>
                <Text style={styles.modalItemText}>📂 根目录（不归类）</Text>
              </TouchableOpacity>
              {folders.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  style={styles.modalItem}
                  onPress={() => void doBatchMove(f.id)}
                >
                  <Text style={styles.modalItemText}>📁 {f.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setMoveModalVisible(false)}
            >
              <Text style={styles.modalCancelText}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// 根据当前颜色和响应式布局生成样式；仅在 isDark / 屏幕尺寸变化时重新创建
function makeStyles(c: ReturnType<typeof useColors>, l: ReturnType<typeof useResponsiveLayout>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    searchBar: {
      flexDirection: 'row',
      padding: l.isTablet ? 16 : 12,
      backgroundColor: c.card,
      borderBottomColor: c.border,
      borderBottomWidth: 1,
    },
    searchInput: {
      flex: 1,
      backgroundColor: c.bg,
      borderRadius: 8,
      padding: 10,
      fontSize: l.bodyFontSize,
      color: c.fg,
    },
    iconButton: { paddingHorizontal: 8, justifyContent: 'center' },
    iconText: { fontSize: 20 },
    filterBar: {
      paddingTop: 8,
      paddingBottom: 4,
      backgroundColor: c.card,
      borderBottomColor: c.border,
      borderBottomWidth: 1,
    },
    chipRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginBottom: 6 },
    folderRow: { paddingHorizontal: 12, marginBottom: 6 },
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bg,
      marginRight: 6,
    },
    chipActive: {
      backgroundColor: c.mint600,
      borderColor: c.mint600,
    },
    chipText: { fontSize: 12, color: c.fg },
    chipTextActive: { color: 'white', fontWeight: '600' },
    card: {
      backgroundColor: c.card,
      marginHorizontal: l.isTablet ? 16 : 12,
      marginTop: 8,
      padding: l.cardPadding,
      borderRadius: 8,
      borderColor: c.border,
      borderWidth: 1,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center' },
    pin: { fontSize: 14, marginRight: 4 },
    fav: { fontSize: 14, marginRight: 4 },
    cardTitle: { fontSize: l.titleFontSize - 2, fontWeight: '600', color: c.fg, flex: 1 },
    cardMeta: { fontSize: 12, color: c.muted, marginTop: 4 },
    empty: { alignItems: 'center', marginTop: 80 },
    emptyEmoji: { fontSize: 48, marginBottom: 12 },
    emptyText: { fontSize: l.bodyFontSize + 2, color: c.fg, marginBottom: 4 },
    emptyHint: { fontSize: 12, color: c.muted },
    retryBtn: {
      marginTop: 12,
      paddingHorizontal: 20,
      paddingVertical: 8,
      backgroundColor: c.mint600,
      borderRadius: 8,
    },
    retryText: { color: 'white', fontSize: l.bodyFontSize, fontWeight: '600' },
    fab: {
      position: 'absolute',
      right: 20,
      bottom: 20,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.mint600,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 4,
      elevation: 5,
    },
    fabLike: {
      position: 'absolute',
      right: 20,
      bottom: 88,
      paddingHorizontal: 16,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    fabLikeText: { fontSize: 14, color: c.fg, fontWeight: '600' },
    fabText: { color: 'white', fontSize: 28, fontWeight: '300' },
    // ── 批量操作 ──
    cardSelected: { borderColor: c.mint600, borderWidth: 2 },
    checkMark: { fontSize: 18, marginRight: 4 },
    batchBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      backgroundColor: c.card,
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingTop: 10,
      paddingBottom: 24,
      paddingHorizontal: 4,
    },
    batchBtn: { flex: 1, alignItems: 'center', paddingVertical: 10 },
    batchBtnText: { fontSize: 13, color: c.fg },
    batchBtnTextStrong: { color: c.mint600, fontWeight: '700' },
    batchBtnTextDanger: { color: '#e5484d', fontWeight: '700' },
    // ── 移动到文件夹弹层 ──
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    modalSheet: {
      backgroundColor: c.card,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      maxHeight: '70%',
      paddingBottom: 24,
    },
    modalTitle: { fontSize: 15, fontWeight: '700', color: c.fg, padding: 16 },
    modalList: { paddingHorizontal: 12 },
    modalItem: {
      paddingVertical: 14,
      paddingHorizontal: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    modalItemText: { fontSize: 15, color: c.fg },
    modalCancel: {
      marginTop: 8,
      marginHorizontal: 16,
      paddingVertical: 12,
      alignItems: 'center',
      borderRadius: 8,
      backgroundColor: c.bg,
    },
    modalCancelText: { fontSize: 15, color: c.muted },
  });
}

/** 筛选 / 排序小标签 */
function FilterChip({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const styles = makeStyles(colors, useResponsiveLayout());
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}
