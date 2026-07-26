/**
 * 笔记列表：左侧抽屉 + 主区卡片列表
 *
 * 移动端使用底部 Tab + 顶部搜索
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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';
import { decryptString, encryptString, type Ciphertext } from '@dustnote/shared';
import { api } from '../api';
import { useAuthStore } from '../state/auth';
import { useColors } from '../theme';

interface NotePlaintext {
  title: string;
  content: string;
  tags: string[];
}

interface NoteRow {
  id: string;
  isPinned: number;
  isFavorite: number;
  deletedAt: string | null;
  serverUpdatedAt: string;
  ciphertext: string;
  folderId: string | null;
}

/** 解析密文信封：兼容新格式 { v, payload } 与旧格式（直接是 Ciphertext） */
function parseEnvelope(raw: string): { v: number; payload: Ciphertext } {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed === 'object' && parsed !== null && 'v' in parsed && 'payload' in parsed) {
    return parsed as { v: number; payload: Ciphertext };
  }
  // 旧格式：直接是 Ciphertext
  if (typeof parsed === 'object' && parsed !== null && 'c' in parsed && 'n' in parsed) {
    return { v: 1, payload: parsed as Ciphertext };
  }
  throw new Error('invalid envelope');
}

/** 解密单条笔记，失败返回占位明文 */
async function decryptNote(masterKey: Uint8Array, ciphertext: string): Promise<NotePlaintext> {
  const env = parseEnvelope(ciphertext);
  const json = await decryptString(masterKey, env.payload);
  return JSON.parse(json) as NotePlaintext;
}

export function NotesListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const colors = useColors();
  const masterKey = useAuthStore((s) => s.masterKey);
  const [notes, setNotes] = useState<Array<NoteRow & { plain: NotePlaintext | null }>>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await api.get<{ notes: NoteRow[] }>('/notes');
      // 在主线程逐条解密（v1 简化；后续可放到 worker）
      const withPlain: Array<NoteRow & { plain: NotePlaintext | null }> = [];
      for (const n of r.notes) {
        let plain: NotePlaintext | null = null;
        if (masterKey) {
          try {
            plain = await decryptNote(masterKey, n.ciphertext);
          } catch {
            plain = { title: '🔒 解密失败', content: '', tags: [] };
          }
        }
        withPlain.push({ ...n, plain });
      }
      setNotes(withPlain);
    } catch (err) {
      console.warn('加载失败', err);
    } finally {
      setRefreshing(false);
    }
  }, [masterKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return notes
      .filter((n) => !n.deletedAt)
      .filter((n) => {
        if (!keyword) return true;
        return n.plain?.title?.toLowerCase().includes(keyword) ?? false;
      })
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return b.serverUpdatedAt.localeCompare(a.serverUpdatedAt);
      });
  }, [notes, search]);

  const styles = makeStyles(colors);

  return (
    <View style={styles.container}>
      {/* 顶部搜索栏 + 快捷入口 */}
      <View style={styles.searchBar}>
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
        <TouchableOpacity onPress={() => navigation.navigate('Tags')} style={styles.iconButton}>
          <Text style={styles.iconText}>🏷️</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Trash')} style={styles.iconButton}>
          <Text style={styles.iconText}>🗑️</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.iconButton}>
          <Text style={styles.iconText}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* 笔记列表 */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📝</Text>
            <Text style={styles.emptyText}>还没有笔记</Text>
            <Text style={styles.emptyHint}>点击右下角按钮创建第一篇</Text>
          </View>
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
        contentContainerStyle={{ paddingBottom: 80 }}
      />

      {/* 新建按钮 */}
      <TouchableOpacity
        style={styles.fab}
        onPress={async () => {
          if (!masterKey) return;
          try {
            // 用真实密文创建空笔记，保证列表展示与其他端一致
            const empty: NotePlaintext = { title: '新笔记', content: '', tags: [] };
            const payload = await encryptString(masterKey, JSON.stringify(empty), 1);
            const env = { v: 1, payload };
            const r = await api.post<{ id: string }>('/notes', {
              ciphertext: JSON.stringify(env),
              keyVersion: 1,
              isPinned: false,
              isFavorite: false,
              clientUpdatedAt: new Date().toISOString(),
              folderId: null,
            });
            navigation.navigate('NoteEdit', { noteId: r.id });
          } catch (err) {
            console.warn('创建失败', err);
          }
        }}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

// 根据当前颜色生成样式；仅在 isDark 变化时重新创建
function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    searchBar: {
      flexDirection: 'row',
      padding: 12,
      backgroundColor: c.card,
      borderBottomColor: c.border,
      borderBottomWidth: 1,
    },
    searchInput: {
      flex: 1,
      backgroundColor: c.bg,
      borderRadius: 8,
      padding: 10,
      fontSize: 14,
      color: c.fg,
    },
    iconButton: { paddingHorizontal: 8, justifyContent: 'center' },
    iconText: { fontSize: 20 },
    card: {
      backgroundColor: c.card,
      marginHorizontal: 12,
      marginTop: 8,
      padding: 14,
      borderRadius: 8,
      borderColor: c.border,
      borderWidth: 1,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center' },
    pin: { fontSize: 14, marginRight: 4 },
    fav: { fontSize: 14, marginRight: 4 },
    cardTitle: { fontSize: 16, fontWeight: '600', color: c.fg, flex: 1 },
    cardMeta: { fontSize: 12, color: c.muted, marginTop: 4 },
    empty: { alignItems: 'center', marginTop: 80 },
    emptyEmoji: { fontSize: 48, marginBottom: 12 },
    emptyText: { fontSize: 16, color: c.fg, marginBottom: 4 },
    emptyHint: { fontSize: 12, color: c.muted },
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
