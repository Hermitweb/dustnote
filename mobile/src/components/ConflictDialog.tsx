/**
 * 冲突裁决弹窗（架构改进 #3 的 mobile 端 UI）
 *
 * 订阅 useConflictStore.pendingConflicts；有未裁决冲突时弹出（一次展示一条，
 * 裁决后自动推进到下一条）。每个冲突字段展示「我的版本 / 服务器版本」diff，
 * 提供四种选择：保留我的 / 保留服务器 / 合并 / 忽略。
 */

import React, { useState } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors } from '../theme';
import { useConflictStore, type PendingConflict } from '../state/conflict-store';

const FIELD_LABEL: Record<string, string> = {
  title: '标题',
  content: '内容',
  tags: '标签',
  isPinned: '置顶',
  isFavorite: '收藏',
  folderId: '文件夹',
  deletedAt: '删除状态',
};

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return '（无）';
  if (field === 'tags') {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    const s = arr.join('、');
    return s.length > 120 ? `${s.slice(0, 120)}…` : s || '（无）';
  }
  if (field === 'isPinned' || field === 'isFavorite') {
    return value ? '是' : '否';
  }
  if (field === 'deletedAt') {
    return value ? '已删除' : '未删除';
  }
  const s = String(value);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s || '（无）';
}

export function ConflictDialog(): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const pendingConflicts = useConflictStore((s) => s.pendingConflicts);
  const resolveConflictChoice = useConflictStore((s) => s.resolveConflictChoice);
  const dismissConflict = useConflictStore((s) => s.dismissConflict);
  const [resolving, setResolving] = useState<'local' | 'server' | 'merged' | null>(null);

  const current: PendingConflict | undefined = pendingConflicts[0];
  const visible = !!current;

  const onChoose = async (choice: 'local' | 'server' | 'merged'): Promise<void> => {
    if (!current) return;
    setResolving(choice);
    try {
      await resolveConflictChoice(current.noteId, choice);
    } catch {
      setResolving(null);
    }
  };

  const onDismiss = (): void => {
    if (!current) return;
    dismissConflict(current.noteId);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.fg }]}>{t('conflict.title')}</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>{t('conflict.subtitle')}</Text>

          {current && (
            <ScrollView style={styles.scroll} nestedScrollEnabled>
              <Text style={[styles.noteTitle, { color: colors.fg }]}>{current.title}</Text>
              {current.conflicts.map((c, i) => (
                <View
                  key={i}
                  style={[
                    styles.conflictBox,
                    { backgroundColor: colors.bg, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.fieldLabel, { color: colors.fg }]}>
                    {FIELD_LABEL[c.field] ?? c.field}
                  </Text>
                  <Text style={[styles.sideLabel, { color: colors.muted }]}>
                    {t('conflict.my_version')}
                  </Text>
                  <Text style={[styles.sideValue, { color: colors.fg }]}>
                    {formatValue(c.field, c.localValue)}
                  </Text>
                  <Text style={[styles.sideLabel, { color: colors.muted }]}>
                    {t('conflict.server_version')}
                  </Text>
                  <Text style={[styles.sideValue, { color: colors.fg }]}>
                    {formatValue(c.field, c.serverValue)}
                  </Text>
                </View>
              ))}
            </ScrollView>
          )}

          <View style={styles.actions}>
            <TouchableOpacity
              disabled={!!resolving}
              onPress={() => void onChoose('local')}
              style={[styles.btn, { backgroundColor: colors.mint600 }]}
            >
              <Text style={styles.btnText}>
                {resolving === 'local' ? t('conflict.resolving') : t('conflict.use_local')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!!resolving}
              onPress={() => void onChoose('server')}
              style={[styles.btn, { backgroundColor: colors.border }]}
            >
              <Text style={[styles.btnText, { color: colors.fg }]}>
                {resolving === 'server' ? t('conflict.resolving') : t('conflict.use_server')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!!resolving}
              onPress={() => void onChoose('merged')}
              style={[styles.btn, { backgroundColor: colors.mint600 }]}
            >
              <Text style={styles.btnText}>
                {resolving === 'merged'
                  ? t('conflict.resolving')
                  : `${t('conflict.use_merged')} · ${t('conflict.merged_hint')}`}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!!resolving}
              onPress={onDismiss}
              style={[styles.btn, { backgroundColor: 'transparent' }]}
            >
              <Text style={[styles.btnText, { color: colors.muted }]}>{t('conflict.dismiss')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    maxHeight: '85%',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    marginBottom: 12,
  },
  scroll: {
    maxHeight: 300,
  },
  noteTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  conflictBox: {
    marginBottom: 12,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  sideLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  sideValue: {
    fontSize: 13,
    marginBottom: 2,
  },
  actions: {
    marginTop: 12,
  },
  btn: {
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    marginBottom: 8,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
