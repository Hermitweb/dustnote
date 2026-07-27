/**
 * 设置页（v2.0.0 双模式架构）
 *
 * 功能：
 * - 外观：主题模式切换（light/dark/auto，持久化到 AsyncStorage）
 * - 模式：显示当前模式 + 切换模式（含数据迁移）
 * - 数据：导入 / 导出（基于 DataRepository.exportBackup / importBackup）
 *   - 导出：生成 JSON → 写入 RNFS → 通过 Share 分享文件
 *   - 导入：从剪贴板粘贴 JSON → 解析 → 调用 importBackup 覆盖式导入
 * - 账户：锁定
 * - 关于：版本号、加密算法、客户端类型
 *
 * 单机模式不显示"分享管理"（无服务端）
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  Share,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';
import { useAuthStore } from '../state/auth';
import { useModeStore } from '../lib/mode-store';
import { createRepository } from '../lib/repository';
import { useColors, useThemeStore, type ThemeMode } from '../theme';
import type { BackupPayload, AppMode } from '@dustnote/shared';
import RNFS from 'react-native-fs';

const APP_VERSION = '2.0.1';
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

  // 模式相关
  const appMode = useModeStore((s) => s.mode);
  const setAppMode = useModeStore((s) => s.setMode);
  const setServerUrl = useModeStore((s) => s.setServerUrl);
  const initialize = useModeStore((s) => s.initialize);
  const masterKey = useAuthStore((s) => s.masterKey);

  // 导入/导出 Modal
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [busy, setBusy] = useState(false);

  // 模式切换 Modal
  const [showSwitchMode, setShowSwitchMode] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<AppMode | null>(null);
  const [switchServerUrl, setSwitchServerUrl] = useState('');

  const styles = makeStyles(colors);

  // ========== 导出 ==========
  const onExport = async () => {
    if (!masterKey) {
      Alert.alert('提示', '请先解锁');
      return;
    }
    setBusy(true);
    try {
      const repo = createRepository({
        mode: appMode,
        serverUrl: useModeStore.getState().serverUrl,
        accessToken: useAuthStore.getState().accessToken,
        deviceId: useAuthStore.getState().deviceId,
      });
      const payload = await repo.exportBackup();
      const json = JSON.stringify(payload, null, 2);
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `dustnote-backup-${ts}.json`;
      // 写入文档目录
      const dir = RNFS.DocumentDirectoryPath;
      const path = `${dir}/${filename}`;
      await RNFS.writeFile(path, json, 'utf8');
      // 通过 RN Share 分享文件（RN 内置 Share.share，第三方库 Share.open 不可用）
      const shareUrl = Platform.OS === 'android' ? `file://${path}` : path;
      try {
        await Share.share({
          url: shareUrl,
          title: 'DustNote 备份',
          message: `DustNote 数据备份 ${ts}`,
        });
      } catch {
        // 用户取消分享时，文件已写入文档目录
        Alert.alert('已导出', `备份文件已保存到：\n${path}\n\n可通过文件管理器查看。`);
      }
    } catch (err) {
      Alert.alert('导出失败', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ========== 导入 ==========
  const onImportConfirm = async () => {
    if (!masterKey) {
      Alert.alert('提示', '请先解锁');
      return;
    }
    if (!importJson.trim()) {
      Alert.alert('提示', '请粘贴备份 JSON');
      return;
    }
    setBusy(true);
    try {
      const payload = JSON.parse(importJson) as BackupPayload;
      if (!payload.notes || !Array.isArray(payload.notes)) {
        throw new Error('无效的备份格式：缺少 notes 字段');
      }
      Alert.alert(
        '确认导入',
        `将覆盖当前所有数据：\n笔记 ${payload.notes.length} 条\n文件夹 ${payload.folders?.length ?? 0} 个\n标签 ${payload.tags?.length ?? 0} 个\n\n继续？`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '确认导入',
            style: 'destructive',
            onPress: async () => {
              try {
                const repo = createRepository({
                  mode: appMode,
                  serverUrl: useModeStore.getState().serverUrl,
                  accessToken: useAuthStore.getState().accessToken,
                  deviceId: useAuthStore.getState().deviceId,
                });
                await repo.clearBusinessData();
                await repo.importBackup(payload);
                Alert.alert('导入成功', '数据已恢复，请重新加载应用', [
                  {
                    text: '确定',
                    onPress: () => {
                      setShowImport(false);
                      setImportJson('');
                      // 重新加载数据（通过锁定 + 解锁流程）
                      lock();
                      navigation.reset({ index: 0, routes: [{ name: 'Unlock' }] });
                    },
                  },
                ]);
              } catch (err) {
                Alert.alert('导入失败', (err as Error).message);
              } finally {
                setBusy(false);
              }
            },
          },
        ]
      );
    } catch (err) {
      Alert.alert('解析失败', `JSON 格式错误：${(err as Error).message}`);
      setBusy(false);
    }
  };

  // ========== 模式切换 ==========
  const onSwitchModeConfirm = async () => {
    if (!masterKey) {
      Alert.alert('提示', '请先解锁');
      return;
    }
    if (!switchTarget) {
      Alert.alert('提示', '请选择目标模式');
      return;
    }
    if (switchTarget === 'online' && !switchServerUrl.trim()) {
      Alert.alert('提示', '联机模式需要填写服务器地址');
      return;
    }
    if (switchTarget === appMode) {
      Alert.alert('提示', '目标模式与当前模式相同');
      return;
    }
    setBusy(true);
    try {
      // 1. 导出当前模式数据
      const oldRepo = createRepository({
        mode: appMode,
        serverUrl: useModeStore.getState().serverUrl,
        accessToken: useAuthStore.getState().accessToken,
        deviceId: useAuthStore.getState().deviceId,
      });
      const backup = await oldRepo.exportBackup();

      // 2. 更新模式状态
      setAppMode(switchTarget);
      if (switchTarget === 'online') {
        setServerUrl(switchServerUrl.trim());
      } else {
        setServerUrl(null);
      }
      initialize();

      // 3. 初始化新模式 Repository
      const newRepo = createRepository({
        mode: switchTarget,
        serverUrl: useModeStore.getState().serverUrl,
        accessToken: useAuthStore.getState().accessToken,
        deviceId: useAuthStore.getState().deviceId,
      });

      // 4. 清空新模式业务数据 + 导入备份
      await newRepo.clearBusinessData();
      await newRepo.importBackup(backup);

      Alert.alert(
        '切换成功',
        `已切换到${switchTarget === 'online' ? '联机' : '单机'}模式，数据已迁移。${
          switchTarget === 'online' ? '\n请重新登录以连接服务器。' : ''
        }`,
        [
          {
            text: '确定',
            onPress: () => {
              setShowSwitchMode(false);
              setSwitchTarget(null);
              setSwitchServerUrl('');
              // 切换模式后需要重新走鉴权流程
              lock();
              if (switchTarget === 'online') {
                navigation.reset({ index: 0, routes: [{ name: 'Unlock' }] });
              } else {
                navigation.reset({ index: 0, routes: [{ name: 'StandaloneUnlock' as never }] });
              }
            },
          },
        ]
      );
    } catch (err) {
      Alert.alert('切换失败', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

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

      <Section title="应用模式" colors={colors}>
        <Row
          label="当前模式"
          detail={appMode === 'standalone' ? '单机模式' : '联机模式'}
          colors={colors}
        />
        <Row
          label="🔄 切换模式"
          onPress={() => {
            setSwitchTarget(appMode === 'standalone' ? 'online' : 'standalone');
            setSwitchServerUrl('');
            setShowSwitchMode(true);
          }}
          colors={colors}
        />
        <Text style={styles.modeHint}>
          切换模式会迁移你的所有数据（笔记、文件夹、标签、偏好）。
          单机→联机：上传到服务器；联机→单机：下载到本地。
        </Text>
      </Section>

      <Section title="数据" colors={colors}>
        <Row
          label="📤 导出备份"
          onPress={onExport}
          colors={colors}
        />
        <Row
          label="📥 导入备份"
          onPress={() => {
            setImportJson('');
            setShowImport(true);
          }}
          colors={colors}
        />
        <Text style={styles.modeHint}>
          导出：生成 JSON 备份文件并分享。{'\n'}
          导入：粘贴备份 JSON 后覆盖式导入（谨慎操作）。
        </Text>
      </Section>

      <Section title="账户" colors={colors}>
        <Row
          label="🔒 锁定"
          onPress={() => {
            lock();
            navigation.reset({
              index: 0,
              routes: [
                { name: appMode === 'standalone' ? ('StandaloneUnlock' as never) : 'Unlock' },
              ],
            });
          }}
          colors={colors}
        />
      </Section>

      <Section title="关于" colors={colors}>
        <Row label="版本" detail={APP_VERSION} colors={colors} />
        <Row label="加密" detail="AES-256-GCM" colors={colors} />
        <Row label="客户端" detail="React Native" colors={colors} />
        <Row
          label="模式"
          detail={appMode === 'standalone' ? '单机（本地存储）' : '联机（服务器同步）'}
          colors={colors}
        />
      </Section>

      {/* 导入 Modal */}
      <Modal visible={showImport} animationType="slide" transparent={false}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>导入备份</Text>
            <TouchableOpacity onPress={() => setShowImport(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>
            粘贴备份 JSON 内容（导出时获得的 JSON 字符串）：
          </Text>
          <TextInput
            style={styles.modalInput}
            multiline
            textAlignVertical="top"
            placeholder='{"version":"2.0.0","notes":[...]...'
            value={importJson}
            onChangeText={setImportJson}
            placeholderTextColor={colors.muted}
          />
          <TouchableOpacity
            style={[styles.modalButton, busy && { opacity: 0.5 }]}
            disabled={busy}
            onPress={onImportConfirm}
          >
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.modalButtonText}>确认导入（覆盖现有数据）</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* 模式切换 Modal */}
      <Modal visible={showSwitchMode} animationType="slide" transparent={false}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>切换模式</Text>
            <TouchableOpacity onPress={() => setShowSwitchMode(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>
            当前模式：{appMode === 'standalone' ? '单机' : '联机'}
            {'\n'}目标模式：{switchTarget === 'standalone' ? '单机（本地存储）' : '联机（服务器同步）'}
            {'\n\n'}将迁移所有数据（笔记、文件夹、标签、偏好）。
          </Text>
          <View style={styles.switchModeRow}>
            <TouchableOpacity
              style={[
                styles.switchModeChip,
                switchTarget === 'standalone' && { backgroundColor: colors.mint600, borderColor: colors.mint600 },
              ]}
              onPress={() => setSwitchTarget('standalone')}
            >
              <Text style={[styles.switchModeChipText, switchTarget === 'standalone' && { color: 'white' }]}>
                📱 单机
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.switchModeChip,
                switchTarget === 'online' && { backgroundColor: colors.mint600, borderColor: colors.mint600 },
              ]}
              onPress={() => setSwitchTarget('online')}
            >
              <Text style={[styles.switchModeChipText, switchTarget === 'online' && { color: 'white' }]}>
                🌐 联机
              </Text>
            </TouchableOpacity>
          </View>
          {switchTarget === 'online' && (
            <TextInput
              style={styles.modalInput}
              placeholder="服务器地址 https://your-server.com"
              value={switchServerUrl}
              onChangeText={setSwitchServerUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholderTextColor={colors.muted}
            />
          )}
          <TouchableOpacity
            style={[styles.modalButton, busy && { opacity: 0.5 }]}
            disabled={busy}
            onPress={onSwitchModeConfirm}
          >
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.modalButtonText}>迁移数据并切换</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>
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
    sectionTitle: {
      fontSize: 12,
      fontWeight: '600',
      color: c.muted,
      marginBottom: 8,
      textTransform: 'uppercase',
    },
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
    modeHint: {
      fontSize: 12,
      color: c.muted,
      padding: 14,
      lineHeight: 18,
    },
    modalContainer: {
      flex: 1,
      backgroundColor: c.bg,
      padding: 16,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      marginBottom: 16,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: c.fg,
    },
    modalClose: {
      fontSize: 22,
      color: c.muted,
      paddingHorizontal: 8,
    },
    modalHint: {
      fontSize: 13,
      color: c.muted,
      lineHeight: 20,
      marginBottom: 12,
    },
    modalInput: {
      flex: 1,
      backgroundColor: c.card,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      fontSize: 14,
      color: c.fg,
      marginBottom: 16,
      minHeight: 120,
    },
    modalButton: {
      backgroundColor: c.mint600,
      borderRadius: 8,
      padding: 16,
      alignItems: 'center',
    },
    modalButtonText: {
      color: 'white',
      fontSize: 15,
      fontWeight: '600',
    },
    switchModeRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 16,
    },
    switchModeChip: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      alignItems: 'center',
    },
    switchModeChipText: {
      fontSize: 14,
      fontWeight: '600',
      color: c.fg,
    },
  });
}
