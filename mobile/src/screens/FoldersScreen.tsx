/**
 * 文件夹管理页
 *
 * 功能：
 * - 列出所有文件夹（GET /folders）
 * - 新建文件夹（POST /folders）
 * - 删除文件夹（DELETE /folders/:id）
 *
 * 交互：顶部内联输入框新建；列表项右侧删除按钮 + Alert 二次确认
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  TextInput,
  Alert,
} from 'react-native';
import { api } from '../api';
import { useColors } from '../theme';

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
}

export function FoldersScreen() {
  const colors = useColors();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await api.get<{ folders: Folder[] }>('/folders');
      setFolders(r.folders);
    } catch (err) {
      console.warn('加载文件夹失败', err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const r = await api.post<{ id: string }>('/folders', { name });
      setFolders((prev) => [
        ...prev,
        {
          id: r.id,
          name,
          parentId: null,
          icon: null,
          sortOrder: 0,
          createdAt: new Date().toISOString(),
        },
      ]);
      setNewName('');
    } catch (err) {
      Alert.alert('创建失败', err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = (folder: Folder) => {
    Alert.alert('删除文件夹', `确定删除「${folder.name}」？文件夹内的笔记不会被删除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/folders/${folder.id}`);
            setFolders((prev) => prev.filter((f) => f.id !== folder.id));
          } catch (err) {
            Alert.alert('删除失败', err instanceof Error ? err.message : String(err));
          }
        },
      },
    ]);
  };

  const styles = makeStyles(colors);

  return (
    <View style={styles.container}>
      {/* 新建输入栏 */}
      <View style={styles.createBar}>
        <TextInput
          style={styles.input}
          placeholder="新建文件夹…"
          placeholderTextColor={colors.muted}
          value={newName}
          onChangeText={setNewName}
          onSubmitEditing={() => void handleCreate()}
          returnKeyType="done"
        />
        <TouchableOpacity
          style={[styles.createBtn, !newName.trim() && { opacity: 0.5 }]}
          onPress={() => void handleCreate()}
          disabled={!newName.trim()}
        >
          <Text style={styles.createBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={folders}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📁</Text>
            <Text style={styles.emptyText}>还没有文件夹</Text>
            <Text style={styles.emptyHint}>在上方输入名称创建第一个</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowIcon}>{item.icon ?? '📁'}</Text>
            <Text style={styles.rowName} numberOfLines={1}>
              {item.name}
            </Text>
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => handleDelete(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.deleteText}>🗑️</Text>
            </TouchableOpacity>
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
    createBar: {
      flexDirection: 'row',
      padding: 12,
      backgroundColor: c.card,
      borderBottomColor: c.border,
      borderBottomWidth: 1,
      gap: 8,
    },
    input: {
      flex: 1,
      backgroundColor: c.bg,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 14,
      color: c.fg,
      borderWidth: 1,
      borderColor: c.border,
    },
    createBtn: {
      width: 40,
      borderRadius: 8,
      backgroundColor: c.mint600,
      justifyContent: 'center',
      alignItems: 'center',
    },
    createBtnText: { color: 'white', fontSize: 22, fontWeight: '300' },
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
    rowIcon: { fontSize: 18, marginRight: 10 },
    rowName: { flex: 1, fontSize: 15, color: c.fg },
    deleteBtn: { paddingHorizontal: 8 },
    deleteText: { fontSize: 16 },
    empty: { alignItems: 'center', marginTop: 80 },
    emptyEmoji: { fontSize: 48, marginBottom: 12 },
    emptyText: { fontSize: 16, color: c.fg, marginBottom: 4 },
    emptyHint: { fontSize: 12, color: c.muted },
  });
}
