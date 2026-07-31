/**
 * 标签管理页
 *
 * 功能：
 * - 列出所有标签
 * - 删除标签
 *
 * v2.0.0 双模式架构：通过 createRepository 工厂按模式分流
 * - standalone → LocalRepository（AsyncStorage）
 * - online     → RemoteRepository（封装 api）
 *
 * 不再直接调用 api.get/delete，避免单机模式下因无服务端而崩溃
 *
 * 注意：标签由笔记内容中的 tags 数组聚合生成，客户端不直接「新建标签」，
 *       而是在编辑笔记时添加。本页主要用于查看和删除无用标签。
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import { useModeStore } from '../lib/mode-store';
import { createRepository } from '../lib/repository';
import { useColors } from '../theme';

interface Tag {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

export function TagsScreen() {
  const colors = useColors();
  const mode = useModeStore((s) => s.mode);
  const modeInitialized = useModeStore((s) => s.initialized);
  const [tags, setTags] = useState<Tag[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // 创建 Repository（按当前模式分流）
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
    try {
      const snapshot = await repo.loadAll();
      setTags(snapshot.tags);
    } catch (err) {
      console.warn('加载标签失败', err);
    } finally {
      setRefreshing(false);
    }
  }, [repo, modeInitialized]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = (tag: Tag) => {
    Alert.alert('删除标签', `确定删除「#${tag.name}」？该标签会从所有笔记中移除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await repo.deleteTag(tag.id);
            setTags((prev) => prev.filter((t) => t.id !== tag.id));
          } catch (err) {
            Alert.alert('删除失败', err instanceof Error ? err.message : String(err));
          }
        },
      },
    ]);
  };

  const styles = makeStyles(colors);

  return (
    <FlatList
      data={tags}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🏷️</Text>
          <Text style={styles.emptyText}>还没有标签</Text>
          <Text style={styles.emptyHint}>在笔记中添加 # 标签后会自动聚合到这里</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.rowHash}>#</Text>
          <Text style={styles.rowName} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{item.count}</Text>
          </View>
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => handleDelete(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.deleteText}>🗑️</Text>
          </TouchableOpacity>
        </View>
      )}
      contentContainerStyle={{ paddingVertical: 8 }}
      style={styles.container}
    />
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.card,
      marginHorizontal: 12,
      marginTop: 8,
      padding: 14,
      borderRadius: 8,
      borderColor: c.border,
      borderWidth: 1,
    },
    rowHash: { fontSize: 16, color: c.mint600, marginRight: 6, fontWeight: '600' },
    rowName: { flex: 1, fontSize: 15, color: c.fg },
    countBadge: {
      backgroundColor: c.bg,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 2,
      marginRight: 8,
      borderWidth: 1,
      borderColor: c.border,
    },
    countText: { fontSize: 12, color: c.muted },
    deleteBtn: { paddingHorizontal: 4 },
    deleteText: { fontSize: 16 },
    empty: { alignItems: 'center', marginTop: 80 },
    emptyEmoji: { fontSize: 48, marginBottom: 12 },
    emptyText: { fontSize: 16, color: c.fg, marginBottom: 4 },
    emptyHint: { fontSize: 12, color: c.muted, textAlign: 'center', paddingHorizontal: 32 },
  });
}
