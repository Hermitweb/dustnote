/**
 * 冲突裁决弹窗（架构改进 #3 的 miniprogram 端 UI）
 *
 * 订阅 useConflictStore.pendingConflicts；有未裁决冲突时弹出（一次展示一条，
 * 裁决后自动推进到下一条）。每个冲突字段展示「我的版本 / 服务器版本」diff，
 * 提供四种选择：保留我的 / 保留服务器 / 合并 / 暂不处理。
 *
 * 说明：miniprogram 无 i18n，文案直接用中文；颜色读取主题 store 生效态。
 */

import React, { useState } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import { useThemeStore } from '../state/theme';
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

function palette(effective: 'light' | 'dark') {
  const dark = effective === 'dark';
  return {
    overlay: 'rgba(0,0,0,0.45)',
    cardBg: dark ? '#1c1f26' : '#ffffff',
    cardBorder: dark ? '#2c313c' : '#e6e8ee',
    fg: dark ? '#f2f4f8' : '#1b1f27',
    muted: dark ? '#9aa3b2' : '#6b7280',
    boxBg: dark ? '#15181e' : '#f4f6fa',
    primary: '#3aa675',
    secondaryBg: dark ? '#2c313c' : '#eceef3',
    secondaryFg: dark ? '#f2f4f8' : '#1b1f27',
  };
}

export default function ConflictDialog(): React.JSX.Element {
  const theme = useThemeStore((s) => s.theme);
  const effective: 'light' | 'dark' =
    theme === 'auto'
      ? typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : 'light'
      : theme;
  const c = palette(effective);

  const pendingConflicts = useConflictStore((s) => s.pendingConflicts);
  const resolveConflictChoice = useConflictStore((s) => s.resolveConflictChoice);
  const dismissConflict = useConflictStore((s) => s.dismissConflict);
  const [resolving, setResolving] = useState<'local' | 'server' | 'merged' | null>(null);

  const current: PendingConflict | undefined = pendingConflicts[0];
  if (!current) return <View />;

  const onChoose = async (choice: 'local' | 'server' | 'merged'): Promise<void> => {
    setResolving(choice);
    try {
      await resolveConflictChoice(current.noteId, choice);
    } catch {
      setResolving(null);
    }
  };

  const onDismiss = (): void => {
    dismissConflict(current.noteId);
  };

  const overlay: React.CSSProperties = {
    position: 'fixed',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: c.overlay,
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  };
  const card: React.CSSProperties = {
    width: '100%',
    maxWidth: 480,
    maxHeight: '88%',
    backgroundColor: c.cardBg,
    borderColor: c.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
  };
  const btnBase: React.CSSProperties = {
    borderRadius: 10,
    padding: '12px 14px',
    alignItems: 'center',
    marginBottom: 10,
  };

  return (
    <View style={overlay}>
      <View style={card}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: c.fg, marginBottom: 4 }}>
          检测到笔记冲突
        </Text>
        <Text style={{ fontSize: 13, color: c.muted, marginBottom: 12 }}>
          该笔记已在其他设备修改，请选择要保留的版本
        </Text>

        <View style={{ flex: 1, minHeight: 0 }}>
          <ScrollView scrollY style={{ maxHeight: 320 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: c.fg, marginBottom: 10 }}>
              {current.title}
            </Text>
            {current.conflicts.map((cf, i) => (
              <View
                key={i}
                style={{
                  marginBottom: 12,
                  padding: 12,
                  borderRadius: 10,
                  backgroundColor: c.boxBg,
                  borderColor: c.cardBorder,
                  borderWidth: 1,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: c.fg, marginBottom: 6 }}>
                  {FIELD_LABEL[cf.field] ?? cf.field}
                </Text>
                <Text style={{ fontSize: 12, color: c.muted, marginTop: 4 }}>我的版本</Text>
                <Text style={{ fontSize: 13, color: c.fg, marginBottom: 2 }}>
                  {formatValue(cf.field, cf.localValue)}
                </Text>
                <Text style={{ fontSize: 12, color: c.muted, marginTop: 4 }}>服务器版本</Text>
                <Text style={{ fontSize: 13, color: c.fg }}>
                  {formatValue(cf.field, cf.serverValue)}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={{ marginTop: 12 }}>
          <View
            style={{ ...btnBase, backgroundColor: c.primary }}
            onClick={() => {
              void onChoose('local');
            }}
          >
            <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '600' }}>
              {resolving === 'local' ? '处理中…' : '保留我的版本'}
            </Text>
          </View>
          <View
            style={{ ...btnBase, backgroundColor: c.secondaryBg }}
            onClick={() => {
              void onChoose('server');
            }}
          >
            <Text style={{ color: c.secondaryFg, fontSize: 14, fontWeight: '600' }}>
              {resolving === 'server' ? '处理中…' : '保留服务器版本'}
            </Text>
          </View>
          <View
            style={{ ...btnBase, backgroundColor: c.primary }}
            onClick={() => {
              void onChoose('merged');
            }}
          >
            <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '600' }}>
              {resolving === 'merged' ? '处理中…' : '使用合并结果'}
            </Text>
          </View>
          <View style={{ ...btnBase, backgroundColor: 'transparent' }} onClick={onDismiss}>
            <Text style={{ color: c.muted, fontSize: 14 }}>暂不处理</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
