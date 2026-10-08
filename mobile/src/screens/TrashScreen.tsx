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

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import { noteAad, type NoteRow, formatNoteStamp } from '@dustnote/shared';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../state/auth';
import { useModeStore } from '../lib/mode-store';
import { createRepository } from '../lib/repository';
import { decryptNote } from '../lib/envelope';
import { errorText } from '../lib/error-text';
import { useColors } from '../theme';
import { Icon } from '../components/Icon';
import { StatePlate } from '../components/StatePlate';

interface NotePlaintext {
  title: string;
  content: string;
  tags: string[];
}

export function TrashScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const masterKey = useAuthStore((s) => s.masterKey);
  const mode = useModeStore((s) => s.mode);
  const modeInitialized = useModeStore((s) => s.initialized);
  const [notes, setNotes] = useState<Array<NoteRow & { plain: NotePlaintext | null }>>([]);
  const [refreshing, setRefreshing] = useState(false);
  // F10 同款（NotesListScreen）：解密循环的世代号——锁屏/卸载/新一轮 load
  // 顶掉它,循环据此提前退出,避免用已清零的 masterKey 空转、以及对已卸载实例 setState
  const loadGenRef = useRef(0);
  useEffect(() => {
    return () => {
      loadGenRef.current += 1; // 卸载即让在途循环失效
    };
  }, []);

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
      // 本轮的世代号：期间发生锁屏/卸载/新一次 load 则整个循环作废（F10）
      const gen = ++loadGenRef.current;
      let stale = false;
      const withPlain: Array<NoteRow & { plain: NotePlaintext | null }> = [];
      let sinceYield = 0;
      for (const n of deleted) {
        if (loadGenRef.current !== gen) {
          stale = true;
          break;
        }
        let plain: NotePlaintext | null = null;
        if (masterKey) {
          try {
            plain = await decryptNote(
              masterKey,
              n.ciphertext,
              noteAad(n.id, useAuthStore.getState().userId ?? '')
            );
          } catch {
            plain = { title: t('editor.decrypt_failed_title'), content: '', tags: [] };
          }
        }
        withPlain.push({ ...n, plain });
        // F9：与列表页同款——每 50 条让出事件循环,回收站大时不再整体冻结
        if (++sinceYield >= 50) {
          sinceYield = 0;
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (loadGenRef.current !== gen) {
            stale = true;
            break;
          }
        }
      }
      // 被顶掉的世代：丢弃本轮结果（可能用了已清零的 masterKey 解密,
      // 或实例已卸载）,由新一轮 load / 卸载清理负责收尾
      if (stale) return;
      // 按删除时间倒序（serverUpdatedAt 作为近似）
      withPlain.sort((a, b) => b.serverUpdatedAt.localeCompare(a.serverUpdatedAt));
      setNotes(withPlain);
    } catch (err) {
      console.warn('加载回收站失败', err);
    } finally {
      setRefreshing(false);
    }
  }, [masterKey, repo, modeInitialized, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRestore = async (id: string) => {
    try {
      await repo.restoreNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      Alert.alert(t('trash.restore_failed'), errorText(err));
    }
  };

  const handlePermanentDelete = (id: string, title: string) => {
    Alert.alert(t('trash.perm_delete'), t('trash.perm_delete_detail', { title }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('trash.perm_delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await repo.permanentDeleteNote(id);
            setNotes((prev) => prev.filter((n) => n.id !== id));
          } catch (err) {
            Alert.alert(t('trash.delete_failed'), errorText(err));
          }
        },
      },
    ]);
  };

  const handleEmptyTrash = () => {
    if (notes.length === 0) return;
    Alert.alert(t('trash.empty_title'), t('trash.empty_confirm', { count: notes.length }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('trash.empty_btn'),
        style: 'destructive',
        onPress: async () => {
          try {
            // 委托给 repo.emptyTrash()（内部顺序删除，避免请求风暴）
            await repo.emptyTrash();
            setNotes([]);
          } catch (err) {
            Alert.alert(t('trash.empty_failed'), errorText(err));
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
          <Text style={styles.toolbarText}>{t('trash.count', { count: notes.length })}</Text>
          <TouchableOpacity onPress={handleEmptyTrash} style={styles.emptyBtn}>
            <Text style={styles.emptyBtnText}>{t('trash.empty_title')}</Text>
          </TouchableOpacity>
        </View>
      )}
      <FlatList
        data={notes}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}
        ListEmptyComponent={<StatePlate illust="plain" title={t('trash.empty')} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.plain?.title ?? '—'}
            </Text>
            <Text style={styles.cardMeta}>{formatNoteStamp(item.serverUpdatedAt)}</Text>
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.restoreBtn}
                onPress={() => void handleRestore(item.id)}
              >
                <Icon name="undo" size={13} color={colors.onAccent} />
                <Text style={styles.restoreText}>{t('trash.restore')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.permBtn}
                onPress={() =>
                  handlePermanentDelete(item.id, item.plain?.title ?? t('trash.this_note'))
                }
              >
                <Text style={styles.permText}>{t('trash.perm_delete')}</Text>
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
    container: { flex: 1, backgroundColor: 'transparent' },
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
      borderColor: c.danger,
    },
    emptyBtnText: { fontSize: 13, color: c.danger },
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
      flexDirection: 'row',
      gap: 5,
    },
    restoreText: { color: c.onAccent, fontSize: 13, fontWeight: '600' },
    permBtn: {
      flex: 1,
      borderRadius: 8,
      backgroundColor: c.bg,
      borderWidth: 1,
      borderColor: c.danger,
      paddingVertical: 8,
      alignItems: 'center',
    },
    permText: { color: c.danger, fontSize: 13, fontWeight: '600' },
  });
}
