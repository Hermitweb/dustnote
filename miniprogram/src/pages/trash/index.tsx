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
import { t, useLanguage } from '../../lib/i18n';

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
  const lang = useLanguage();
  const [notes, setNotes] = useState<Note[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // 语言切换后同步原生导航栏标题
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('app.name') });
  }, [lang]);

  const load = async () => {
    setLoading(true);
    try {
      const snapshot = await getRepo().loadAll();
      const deleted = (snapshot.notes as Note[]).filter((n) => n.deletedAt);
      deleted.sort((a, b) => b.serverUpdatedAt.localeCompare(a.serverUpdatedAt));
      setNotes(deleted);
      if (masterKey) {
        const titleMap: Record<string, string> = {};
        for (const n of deleted) {
          try {
            const e = parseEnvelope(n.ciphertext);
            titleMap[n.id] = (
              await decryptNote(masterKey, e, noteAad(n.id, useAuthStore.getState().userId ?? ''))
            ).title;
          } catch {
            titleMap[n.id] = t('common.decrypt_failed');
          }
        }
        setTitles(titleMap);
      }
    } catch {
      Taro.showToast({ title: t('common.load_failed'), icon: 'none' });
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
      Taro.showToast({ title: t('common.restored'), icon: 'success' });
      await load();
    } catch {
      Taro.showToast({ title: t('common.restore_failed'), icon: 'none' });
    }
  };

  const handlePermanentDelete = async (n: Note) => {
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

  const handleEmptyTrash = async () => {
    if (notes.length === 0) return;
    const r = await Taro.showModal({
      title: t('trash.clear_title'),
      content: t('trash.clear_content', { count: notes.length }),
      confirmText: t('trash.empty_btn'),
      confirmColor: '#E07B6C',
    });
    if (!r.confirm) return;
    try {
      const result = (await getRepo().emptyTrash()) as unknown as
        | { deleted: number; failed: number }
        | undefined;
      const deleted = result?.deleted ?? 0;
      const failed = result?.failed ?? 0;
      if (failed > 0) {
        Taro.showToast({
          title: t('trash.cleared_count', { deleted, failed }),
          icon: 'none',
        });
      } else {
        Taro.showToast({ title: t('trash.cleared'), icon: 'success' });
      }
      await load();
    } catch {
      Taro.showToast({ title: t('trash.clear_failed'), icon: 'none' });
    }
  };

  return (
      <View className="page">
      <View className="topbar">
        <Text className="topbar-back" onClick={() => Taro.navigateBack()}>
          ←
        </Text>
        <Text className="topbar-title">{t('trash.title')}</Text>
        <Text className="topbar-actions">
          {notes.length > 0 && (
            <Text
              className="topbar-action-text text-danger"
              onClick={() => void handleEmptyTrash()}
            >
              {t('trash.empty_btn')}
            </Text>
          )}
        </Text>
      </View>

      <ScrollView scrollY className="flex-1">
        {loading && <View className="loading">{t('common.loading')}</View>}
        {!loading && notes.length === 0 && (
          <View className="empty-state">
            <Text className="empty-state-icon">🗑️</Text>
            <Text className="empty-state-text">{t('trash.empty')}</Text>
          </View>
        )}
        {notes.map((n) => (
          <View key={n.id} className="note-row">
            <View className="note-row-head">
              <View className="note-icons">
                {n.isPinned ? <Text>📌</Text> : null}
                {n.isFavorite ? <Text>⭐</Text> : null}
              </View>
              <Text className="note-title">{titles[n.id] || t('common.unnamed_note')}</Text>
            </View>
            <Text className="note-meta">{new Date(n.serverUpdatedAt).toLocaleString('zh-CN')}</Text>
            <View className="note-actions">
              <Text
                className="mint-btn mint-btn-sm mint-btn-ghost"
                onClick={() => void handleRestore(n)}
              >
                {t('common.restore')}
              </Text>
              <Text
                className="mint-btn mint-btn-sm mint-btn-danger"
                onClick={() => void handlePermanentDelete(n)}
              >
                {t('common.perm_delete')}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
