/**
 * 小程序回收站页
 *
 * 功能：列出已软删笔记 / 恢复 / 永久删除 / 清空回收站
 * 复用 index 页 note-row 样式
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useAuthStore, decryptNote, parseEnvelope } from '../../state/auth';
import { getRepo } from '../../lib/get-repo';
import { noteAad } from '@dustnote/shared';

interface Note {
  id: string;
  ciphertext: string;
  isPinned: boolean;
  isFavorite: boolean;
  deletedAt: string | null;
  version: number;
  serverUpdatedAt: string;
  folderId: string | null;
}

export default function Trash() {
  const masterKey = useAuthStore((s) => s.masterKey);
  const [notes, setNotes] = useState<Note[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const snapshot = await getRepo().loadAll();
      const deleted = (snapshot.notes as Note[]).filter((n) => n.deletedAt);
      deleted.sort((a, b) => b.serverUpdatedAt.localeCompare(a.serverUpdatedAt));
      setNotes(deleted);
      if (masterKey) {
        const t: Record<string, string> = {};
        for (const n of deleted) {
          try {
            const e = parseEnvelope(n.ciphertext);
            t[n.id] = (
              await decryptNote(masterKey, e, noteAad(n.id, useAuthStore.getState().userId ?? ''))
            ).title;
          } catch {
            t[n.id] = '🔒 解密失败';
          }
        }
        setTitles(t);
      }
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [masterKey]);
  useDidShow(() => {
    void load();
  });

  const handleRestore = async (n: Note) => {
    try {
      await getRepo().restoreNote(n.id);
      Taro.showToast({ title: '已恢复', icon: 'success' });
      await load();
    } catch {
      Taro.showToast({ title: '恢复失败', icon: 'none' });
    }
  };

  const handlePermanentDelete = async (n: Note) => {
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

  const handleEmptyTrash = async () => {
    if (notes.length === 0) return;
    const r = await Taro.showModal({
      title: '清空回收站',
      content: `确定永久删除回收站中的 ${notes.length} 条笔记？此操作不可恢复。`,
      confirmText: '清空',
      confirmColor: '#E07B6C',
    });
    if (!r.confirm) return;
    try {
      await getRepo().emptyTrash();
      Taro.showToast({ title: '已清空', icon: 'success' });
      await load();
    } catch {
      Taro.showToast({ title: '清空失败', icon: 'none' });
    }
  };

  return (
    <View className="page">
      <View className="topbar">
        <Text className="topbar-back" onClick={() => Taro.navigateBack()}>
          ←
        </Text>
        <Text className="topbar-title">回收站</Text>
        <Text className="topbar-actions">
          {notes.length > 0 && (
            <Text
              className="topbar-action-text text-danger"
              onClick={() => void handleEmptyTrash()}
            >
              清空
            </Text>
          )}
        </Text>
      </View>

      <ScrollView scrollY className="flex-1">
        {loading && <View className="loading">加载中…</View>}
        {!loading && notes.length === 0 && (
          <View className="empty-state">
            <Text className="empty-state-icon">🗑️</Text>
            <Text className="empty-state-text">回收站为空</Text>
          </View>
        )}
        {notes.map((n) => (
          <View key={n.id} className="note-row">
            <View className="note-row-head">
              <View className="note-icons">
                {n.isPinned ? <Text>📌</Text> : null}
                {n.isFavorite ? <Text>⭐</Text> : null}
              </View>
              <Text className="note-title">{titles[n.id] || '🌿 未命名笔记'}</Text>
            </View>
            <Text className="note-meta">{new Date(n.serverUpdatedAt).toLocaleString('zh-CN')}</Text>
            <View className="note-actions">
              <Text
                className="mint-btn mint-btn-sm mint-btn-ghost"
                onClick={() => void handleRestore(n)}
              >
                恢复
              </Text>
              <Text
                className="mint-btn mint-btn-sm mint-btn-danger"
                onClick={() => void handlePermanentDelete(n)}
              >
                永久删除
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
