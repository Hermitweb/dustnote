/**
 * 回收站页
 *
 * 功能：
 * - 列出已软删的笔记
 * - 恢复笔记
 * - 永久删除
 * - 清空回收站（顺序删除，避免请求风暴）
 *
 * v2.0.0 双模式架构：通过 createRepository 工厂按模式分流
 * - standalone → LocalRepository（AsyncStorage）
 * - online     → RemoteRepository（封装 api）
 *
 * 不再直接调用 api.get/patch/delete，避免单机模式下因无服务端而崩溃
 *
 * 解密复用 NotesListScreen 的 envelope 解析逻辑
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
import { noteAad, type NoteRow } from '@dustnote/shared';
import { useAuthStore } from '../state/auth';
import { useModeStore } from '../lib/mode-store';
import { createRepository } from '../lib/repository';
import { decryptNote } from '../lib/envelope';
import { useColors } from '../theme';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';

interface NotePlaintext {
  title: string;
  content: string;
  tags: string[];
}

export function TrashScreen() {
  const colors = useColors();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const masterKey = useAuthStore((s) => s.masterKey);
  const mode = useModeStore((s) => s.mode);
  const modeInitialized = useModeStore((s) => s.initialized);
  const [notes, setNotes] = useState<Array<NoteRow & { plain: NotePlaintext | null }>>([]);
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
      const deleted = snapshot.notes.filter((n) => n.deletedAt);
      const withPlain: Array<NoteRow & { plain: NotePlaintext | null }> = [];
      for (const n of deleted) {
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
      // 按删除时间倒序（serverUpdatedAt 作为近似）
      withPlain.sort((a, b) => b.serverUpdatedAt.localeCompare(a.serverUpdatedAt));
      setNotes(withPlain);
    } catch (err) {
      console.warn('加载回收站失败', err);
    } finally {
      setRefreshing(false);
    }
  }, [masterKey, repo, modeInitialized]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRestore = async (id: string) => {
    try {
      await repo.restoreNote(id);
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
            await repo.permanentDeleteNote(id);
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
            // 委托给 repo.emptyTrash()（内部顺序删除，避免请求风暴）
            await repo.emptyTrash();
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
      {/* 顶部返回栏（此前无返回按钮，只能靠系统手势） */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>🗑️ 回收站</Text>
        <View style={{ width: 60 }} />
      </View>
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
                onPress={() => void handleRestore(item.id)}
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
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 12,
      backgroundColor: c.card,
      borderBottomColor: c.border,
      borderBottomWidth: 1,
    },
    backBtn: { padding: 4 },
    backText: { fontSize: 15, color: c.mint600 },
    topTitle: { fontSize: 15, fontWeight: '600', color: c.fg },
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
