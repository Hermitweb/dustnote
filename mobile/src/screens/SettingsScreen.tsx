/**
 * 设置页：主题模式 / 数据 / 锁定 / 关于
 *
 * 已实现：主题模式切换（light/dark/auto，持久化到 AsyncStorage）、锁定
 * 暂未实现：导入 / 导出、分享管理（保留提示）
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';
import { useAuthStore } from '../state/auth';
import { useColors, useThemeStore, type ThemeMode } from '../theme';

const MODE_OPTIONS: Array<{ mode: ThemeMode; label: string }> = [
  { mode: 'light', label: '☀️ 浅色' },
  { mode: 'dark', label: '🌙 深色' },
  { mode: 'auto', label: '📱 跟随系统' },
];

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const colors = useColors();
  const lock = useAuthStore((s) => s.lock);
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  const styles = makeStyles(colors);

  return (
    <ScrollView style={styles.container}>
      <Section title="外观" colors={colors}>
        <View style={styles.modeRow}>
          {MODE_OPTIONS.map((opt) => {
            const active = mode === opt.mode;
            return (
              <TouchableOpacity
                key={opt.mode}
                style={[
                  styles.modeChip,
                  active && { backgroundColor: colors.mint600, borderColor: colors.mint600 },
                ]}
                onPress={() => setMode(opt.mode)}
              >
                <Text style={[styles.modeChipText, active && { color: 'white' }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Section>

      <Section title="数据" colors={colors}>
        <Row label="📥📤 导入 / 导出" onPress={() => Alert.alert('提示', 'v1 简化：暂未在移动端实现')} colors={colors} />
        <Row label="🔗 分享管理" onPress={() => Alert.alert('提示', 'v1 简化：暂未在移动端实现')} colors={colors} />
      </Section>

      <Section title="账户" colors={colors}>
        <Row
          label="🔒 锁定"
          onPress={() => {
            lock();
            navigation.reset({ index: 0, routes: [{ name: 'Unlock' }] });
          }}
          colors={colors}
        />
        <Row label="🔄 重新登录" onPress={() => Alert.alert('提示', 'v1.1 实现')} colors={colors} />
      </Section>

      <Section title="关于" colors={colors}>
        <Row label="版本" detail="0.1.0" colors={colors} />
        <Row label="加密" detail="AES-256-GCM" colors={colors} />
        <Row label="客户端" detail="React Native" colors={colors} />
      </Section>
    </ScrollView>
  );
}

function Section({
  title,
  children,
  colors,
}: {
  title: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  const styles = makeStyles(colors);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({
  label,
  detail,
  onPress,
  colors,
}: {
  label: string;
  detail?: string;
  onPress?: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress}>
      <Text style={styles.rowLabel}>{label}</Text>
      {detail && <Text style={styles.rowDetail}>{detail}</Text>}
    </TouchableOpacity>
  );
}

// 根据当前颜色生成样式；仅在 isDark 变化时重新创建
function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    section: { padding: 16 },
    sectionTitle: { fontSize: 12, fontWeight: '600', color: c.muted, marginBottom: 8, textTransform: 'uppercase' },
    card: {
      backgroundColor: c.card,
      borderRadius: 8,
      borderColor: c.border,
      borderWidth: 1,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 14,
      borderBottomColor: c.border,
      borderBottomWidth: 1,
    },
    rowLabel: { fontSize: 15, color: c.fg },
    rowDetail: { fontSize: 13, color: c.muted },
    modeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      padding: 14,
    },
    modeChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bg,
    },
    modeChipText: { fontSize: 13, color: c.fg },
  });
}
