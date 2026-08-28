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
  // 筛选 / 排序（v2.4.4 新增）
  const [tab, setTab] = useState<'all' | 'fav'>('all');
  const [folderFilter, setFolderFilter] = useState<string>('all'); // 'all' | folderId
  const [sortBy, setSortBy] = useState<'time' | 'title' | 'words'>('time');
  const [folders, setFolders] = useState<Folder[]>([]);

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
        // 置顶优先（所有排序方式都保持）
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        if (sortBy === 'title') {
          return (a.plain?.title ?? '').localeCompare(b.plain?.title ?? '', 'zh-CN');
        }
        if (sortBy === 'words') {
          return (b.plain?.content?.length ?? 0) - (a.plain?.content?.length ?? 0);
        }
        return b.serverUpdatedAt.localeCompare(a.serverUpdatedAt);
      });
  }, [notes, search, tab, folderFilter, sortBy]);

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

      {/* 筛选 / 排序栏（v2.4.4 新增） */}
      <View style={styles.filterBar}>
        <View style={styles.chipRow}>
          <FilterChip
            label="全部"
            active={tab === 'all'}
            onPress={() => setTab('all')}
            colors={colors}
          />
          <FilterChip
            label="⭐ 收藏"
            active={tab === 'fav'}
            onPress={() => setTab('fav')}
            colors={colors}
          />
          <View style={{ flex: 1 }} />
          <FilterChip
            label="⏱ 时间"
            active={sortBy === 'time'}
            onPress={() => setSortBy('time')}
            colors={colors}
          />
          <FilterChip
            label="🔤 标题"
            active={sortBy === 'title'}
            onPress={() => setSortBy('title')}
            colors={colors}
          />
          <FilterChip
            label="🔢 字数"
            active={sortBy === 'words'}
            onPress={() => setSortBy('words')}
            colors={colors}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.folderRow}>
          <FilterChip
            label="📂 全部文件夹"
            active={folderFilter === 'all'}
            onPress={() => setFolderFilter('all')}
            colors={colors}
          />
          {folders.map((f) => (
            <FilterChip
              key={f.id}
              label={`📁 ${f.name}`}
              active={folderFilter === f.id}
              onPress={() => setFolderFilter(f.id)}
              colors={colors}
            />
          ))}
        </ScrollView>
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
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>📝</Text>
              <Text style={styles.emptyText}>还没有笔记</Text>
              <Text style={styles.emptyHint}>点击右下角按钮创建第一篇</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('NoteEdit', { noteId: item.id })}
          >
            <View style={styles.cardHeader}>
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
          paddingBottom: 80,
          // 平板：限制内容宽度并居中，提升阅读体验
          ...(layout.isTablet
            ? { maxWidth: layout.maxContentWidth, alignSelf: 'center', width: '100%' }
            : {}),
        }}
      />

      {/* 新建按钮 */}
      <TouchableOpacity
        style={styles.fab}
        onPress={async () => {
          if (!masterKey) return;
          try {
            // 用真实密文创建空笔记，保证列表展示与其他端一致
            const empty: NotePlaintext = { title: '新笔记', content: '', tags: [] };
            const ciphertext = await packEnvelope(masterKey, empty);
            // 当前选中文件夹 → 新笔记归属该文件夹
            const targetFolderId = folderFilter !== 'all' ? folderFilter : null;
            await repo.createNote({
              ciphertext,
              keyVersion: 1,
              isPinned: false,
              isFavorite: false,
              folderId: targetFolderId,
            });
            await load();
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
    fabText: { color: 'white', fontSize: 28, fontWeight: '300' },
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
