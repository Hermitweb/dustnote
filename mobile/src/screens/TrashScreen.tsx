/**
 * 回收站页
 *
 * 功能：
 * - 列出已软删的笔记（GET /notes?includeDeleted=1 → filter deletedAt）
 * - 恢复笔记（PATCH /notes/:id { deletedAt: null }）
 * - 永久删除（DELETE /notes/:id/permanent）
 * - 清空回收站（批量永久删除）
 *
 * 解密复用 NotesListScreen 的 envelope 解析逻辑
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import { decryptString, type Ciphertext } from '@dustnote/shared';
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
  version: number;
}

function parseEnvelope(raw: string): { v: number; payload: Ciphertext } {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed === 'object' && parsed !== null && 'v' in parsed && 'payload' in parsed) {
    return parsed as { v: number; payload: Ciphertext };
  }
  if (typeof parsed === 'object' && parsed !== null && 'c' in parsed && 'n' in parsed) {
    return { v: 1, payload: parsed as Ciphertext };
  }
  throw new Error('invalid envelope');
}

async function decryptNote(masterKey: Uint8Array, ciphertext: string): Promise<NotePlaintext> {
  const env = parseEnvelope(ciphertext);
  const json = await decryptString(masterKey, env.payload);
  return JSON.parse(json) as NotePlaintext;
}

export function TrashScreen() {
  const colors = useColors();
  const masterKey = useAuthStore((s) => s.masterKey);
  const [notes, setNotes] = useState<Array<NoteRow & { plain: NotePlaintext | null }>>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await api.get<{ notes: NoteRow[] }>('/notes?includeDeleted=1');
      const deleted = r.notes.filter((n) => n.deletedAt);
      const withPlain: Array<NoteRow & { plain: NotePlaintext | null }> = [];
      for (const n of deleted) {
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
      // 按删除时间倒序（serverUpdatedAt 作为近似）
      withPlain.sort((a, b) => b.serverUpdatedAt.localeCompare(a.serverUpdatedAt));
      setNotes(withPlain);
    } catch (err) {
      console.warn('加载回收站失败', err);
    } finally {
      setRefreshing(false);
    }
  }, [masterKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRestore = async (id: string, version: number) => {
    try {
      await api.patch(`/notes/${id}`, {
        deletedAt: null,
        clientUpdatedAt: new Date().toISOString(),
        version,
      });
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      Alert.alert('恢复失败', err instanceof Error ? err.message : String(err));
    }
  };

  const handlePermanentDelete = (id: string, title: string) => {
    Alert.alert('永久删除', `确定永久删除「${title}」？此操作不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '永久删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/notes/${id}/permanent`);
            setNotes((prev) => prev.filter((n) => n.id !== id));
          } catch (err) {
            Alert.alert('删除失败', err instanceof Error ? err.message : String(err));
          }
        },
      },
    ]);
  };

  const handleEmptyTrash = () => {
    if (notes.length === 0) return;
    Alert.alert('清空回收站', `确定永久删除回收站中的 ${notes.length} 条笔记？此操作不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: async () => {
          try {
            await Promise.all(notes.map((n) => api.delete(`/notes/${n.id}/permanent`)));
            setNotes([]);
          } catch (err) {
            Alert.alert('清空失败', err instanceof Error ? err.message : String(err));
            void load();
          }
        },
      },
    ]);
  };

  const styles = makeStyles(colors);

  return (
    <View style={styles.container}>
      {notes.length > 0 && (
        <View style={styles.toolbar}>
          <Text style={styles.toolbarText}>{notes.length} 条笔记</Text>
          <TouchableOpacity onPress={handleEmptyTrash} style={styles.emptyBtn}>
            <Text style={styles.emptyBtnText}>清空回收站</Text>
          </TouchableOpacity>
        </View>
      )}
      <FlatList
        data={notes}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🗑️</Text>
            <Text style={styles.emptyText}>回收站为空</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.plain?.title ?? '🔒'}
            </Text>
            <Text style={styles.cardMeta}>
              {new Date(item.serverUpdatedAt).toLocaleString('zh-CN')}
            </Text>
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.restoreBtn}
                onPress={() => void handleRestore(item.id, item.version)}
              >
                <Text style={styles.restoreText}>↩ 恢复</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.permBtn}
                onPress={() => handlePermanentDelete(item.id, item.plain?.title ?? '该笔记')}
              >
                <Text style={styles.permText}>永久删除</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 12,
      backgroundColor: c.card,
      borderBottomColor: c.border,
      borderBottomWidth: 1,
    },
    toolbarText: { fontSize: 13, color: c.muted },
    emptyBtn: {
      backgroundColor: c.bg,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: '#dc2626',
    },
    emptyBtnText: { fontSize: 13, color: '#dc2626' },
    card: {
      backgroundColor: c.card,
      marginHorizontal: 12,
      marginTop: 8,
      padding: 14,
      borderRadius: 8,
      borderColor: c.border,
      borderWidth: 1,
    },
    cardTitle: { fontSize: 16, fontWeight: '600', color: c.fg },
    cardMeta: { fontSize: 12, color: c.muted, marginTop: 4 },
    actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
    restoreBtn: {
      flex: 1,
      borderRadius: 8,
      backgroundColor: c.mint600,
      paddingVertical: 8,
      alignItems: 'center',
    },
    restoreText: { color: 'white', fontSize: 13, fontWeight: '600' },
    permBtn: {
      flex: 1,
      borderRadius: 8,
      backgroundColor: c.bg,
      borderWidth: 1,
      borderColor: '#dc2626',
      paddingVertical: 8,
      alignItems: 'center',
    },
    permText: { color: '#dc2626', fontSize: 13, fontWeight: '600' },
    empty: { alignItems: 'center', marginTop: 80 },
    emptyEmoji: { fontSize: 48, marginBottom: 12 },
    emptyText: { fontSize: 16, color: c.fg },
  });
}
