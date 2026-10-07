/**
 * 小程序回收站页
 *
 * 功能：列出已软删笔记 / 恢复 / 永久删除 / 清空回收站
 * 复用 index 页 note-row 样式
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { ThemeVars, useThemeDarkClass } from '../../components/ThemeVars';
import { useAuthStore, decryptNote, parseEnvelope } from '../../state/auth';
import { getRepo } from '../../lib/get-repo';
import { confirmDangerColor } from '../../lib/confirm-color';
import { noteAad, formatNoteStamp } from '@dustnote/shared';
import { t, useLanguage } from '../../lib/i18n';
import { Icon } from '../../components/Icon';
import { StatePlate } from '../../components/StatePlate';

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

  /**
   * Bug 修（返回本页/后台事件触发 load 时列表被拽回顶、刷新圈卡死不收——weapp 的
   * refresherTriggered=true 会强制撑开下拉头，绑在共享 loading 上时任何后台 load
   * 一翻就触发；与首页同源同修（2026-10-07 批次））。refreshing 只由用户主动下拉翻转；
   * load 加尾随补跑锁：并发时记一笔、前一次跑完补跑一次——恢复/删除/清空
   * 都靠 await load() 看到结果，不能被并发窗口吞掉。
   */
  const [refreshing, setRefreshing] = useState(false);
  const loadInFlightRef = useRef(false);
  const loadQueuedRef = useRef(false);
  const load = async () => {
    if (loadInFlightRef.current) {
      loadQueuedRef.current = true;
      return;
    }
    loadInFlightRef.current = true;
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
      loadInFlightRef.current = false;
      setLoading(false);
      if (loadQueuedRef.current) {
        loadQueuedRef.current = false;
        void load();
      }
    }
  };
  const onPullRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // 同上：load 是每次渲染的新函数，进依赖会无限重拉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterKey]);
  // 离线队列重放成功后立即校正
  useEffect(() => {
    const handler = () => void load();
    Taro.eventCenter.on('dustnote:data-changed', handler);
    return () => {
      Taro.eventCenter.off('dustnote:data-changed', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      confirmColor: confirmDangerColor(),
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
      confirmColor: confirmDangerColor(),
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

  const darkClass = useThemeDarkClass();
  return (
    <>
      <ThemeVars />
      <View className={`page ${darkClass}`}>
        <View className="topbar">
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

        <ScrollView
          scrollY
          className="flex-1"
          refresherEnabled
          refresherTriggered={refreshing}
          onRefresherRefresh={() => void onPullRefresh()}
        >
          {loading && <View className="loading">{t('common.loading')}</View>}
          {!loading && notes.length === 0 && <StatePlate illust="plain" title={t('trash.empty')} />}
          {notes.map((n) => (
            <View key={n.id} className="note-row">
              <View className="note-row-head">
                <View className="note-icons">
                  {n.isPinned ? <Icon name="pin" size={14} /> : null}
                  {n.isFavorite ? <Icon name="star" size={14} /> : null}
                </View>
                <Text className="note-title">{titles[n.id] || t('common.unnamed_note')}</Text>
              </View>
              <Text className="note-meta">{formatNoteStamp(n.serverUpdatedAt)}</Text>
              <View className="note-actions">
                <Text className="btn btn-sm btn-ghost" onClick={() => void handleRestore(n)}>
                  {t('common.restore')}
                </Text>
                <Text
                  className="btn btn-sm btn-danger"
                  onClick={() => void handlePermanentDelete(n)}
                >
                  {t('common.perm_delete')}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </>
  );
}
