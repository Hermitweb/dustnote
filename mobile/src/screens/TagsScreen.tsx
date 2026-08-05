/**
 * 标签管理页
 *
 * 功能：
 * - 从笔记内容中聚合标签（解密每条笔记的 tags 数组，统计数量）
 * - 删除标签：从所有包含该标签的笔记中移除（解密→过滤→重新加密→更新）
 *
 * v2.0.0 双模式架构：通过 createRepository 工厂按模式分流
 * - standalone → LocalRepository（AsyncStorage）
 * - online     → RemoteRepository（封装 api）
 *
 * 标签由笔记内容中的 tags 数组聚合生成，客户端不直接「新建标签」，
 * 而是在编辑笔记时添加。本页主要用于查看和删除无用标签。
 *
 * 注：聚合需要 masterKey 解密笔记；未解锁时不显示标签。
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useModeStore } from '../lib/mode-store';
import { createRepository } from '../lib/repository';
import { useColors } from '../theme';
import { useAuthStore } from '../state/auth';
import {
  decryptString,
  encryptString,
  type Ciphertext,
  type NoteRow,
} from '@dustnote/shared';

interface Tag {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

interface NoteEnvelope {
  v: number;
  payload: Ciphertext;
}

/** 解析密文信封：兼容新格式 { v, payload } 与旧格式（直接是 Ciphertext） */
function parseEnvelope(raw: string): NoteEnvelope {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed === 'object' && parsed !== null && 'v' in parsed && 'payload' in parsed) {
    return parsed as NoteEnvelope;
  }
  if (typeof parsed === 'object' && parsed !== null && 'c' in parsed && 'n' in parsed) {
    return { v: 1, payload: parsed as Ciphertext };
  }
  throw new Error('invalid envelope');
}

export function TagsScreen() {
  const colors = useColors();
  const mode = useModeStore((s) => s.mode);
  const modeInitialized = useModeStore((s) => s.initialized);
  const masterKey = useAuthStore((s) => s.masterKey);
  const [tags, setTags] = useState<Tag[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

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
    if (!modeInitialized || !masterKey) return;
    setRefreshing(true);
    try {
      const snapshot = await repo.loadAll();
      const activeNotes = snapshot.notes.filter((n) => !n.deletedAt);
      // 客户端解密每条笔记，聚合 tags
      const tagMap = new Map<string, Tag>();
      for (const note of activeNotes) {
        try {
          const env = parseEnvelope(note.ciphertext);
          const json = await decryptString(masterKey, env.payload);
          const pt = JSON.parse(json) as { tags?: string[] };
          if (Array.isArray(pt.tags)) {
            for (const tagName of pt.tags) {
              const name = String(tagName);
              const existing = tagMap.get(name);
              if (existing) {
                existing.count += 1;
              } else {
                tagMap.set(name, { id: `local-${name}`, name, color: null, count: 1 });
              }
            }
          }
        } catch {
          // 解密失败的笔记跳过（不影响其他笔记的标签聚合）
        }
      }
      // 按数量降序排列
      setTags(Array.from(tagMap.values()).sort((a, b) => b.count - a.count));
    } catch (err) {
      console.warn('加载标签失败', err);
    } finally {
      setRefreshing(false);
    }
  }, [repo, modeInitialized, masterKey]);

  // useFocusEffect：每次进入标签页时重新聚合，确保从 NoteEditScreen 添加标签后立即刷新
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const handleDelete = (tag: Tag) => {
    Alert.alert('删除标签', `确定删除「#${tag.name}」？该标签会从所有笔记中移除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          if (!masterKey) return;
          setBusy(true);
          try {
            const snapshot = await repo.loadAll();
            const targets = snapshot.notes.filter(
              (n) => !n.deletedAt && n.id !== tag.id
            );
            let changed = 0;
            for (const note of targets) {
              try {
                const env = parseEnvelope(note.ciphertext);
                const json = await decryptString(masterKey, env.payload);
                const pt = JSON.parse(json) as {
                  title: string;
                  content: string;
                  tags?: string[];
                };
                if (!Array.isArray(pt.tags) || !pt.tags.includes(tag.name)) continue;
                const nextTags = pt.tags.filter((x) => x !== tag.name);
                const nextJson = JSON.stringify({ ...pt, tags: nextTags });
                const payload = await encryptString(masterKey, nextJson, 1);
                const env2: NoteEnvelope = { v: 1, payload };
                await repo.updateNote(note.id, {
                  ciphertext: JSON.stringify(env2),
                  keyVersion: 1,
                  isPinned: !!note.isPinned,
                  isFavorite: !!note.isFavorite,
                  version: note.version,
                });
                changed++;
              } catch {
                // 单条笔记处理失败跳过，继续处理其他
              }
            }
            setTags((prev) => prev.filter((t) => t.id !== tag.id));
            Alert.alert('已删除', `已从 ${changed} 条笔记中移除「#${tag.name}」`);
          } catch (err) {
            Alert.alert('删除失败', err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const styles = makeStyles(colors);

  if (!masterKey) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.mint600} />
        <Text style={{ marginTop: 12, color: colors.muted }}>请先解锁</Text>
      </View>
    );
  }

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
            disabled={busy}
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
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
