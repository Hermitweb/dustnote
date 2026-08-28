/**
 * 模式选择页（v2.0.0 单机/联机双模式）
 *
 * 首次启动时显示，让用户选择使用模式：
 * - 单机模式（standalone）：无服务器，数据存储在本地（AsyncStorage）
 *   适合个人使用，数据不离开设备，隐私优先
 * - 联机模式（online）：连接服务器解锁全部功能（跨设备同步、在线分享等）
 *   需要部署 DustNote 服务端并填写服务器地址
 *
 * 选择完成后调用 useModeStore.initialize() 标记已初始化，
 * App.tsx 会自动根据 mode 路由到对应的鉴权页面。
 *
 * 后续可在设置中切换模式（含数据迁移）。
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import logoImage from '../assets/logo.png';
import { useTranslation } from 'react-i18next';
import { useModeStore } from '../lib/mode-store';
import { useColors } from '../theme';
import { api } from '../api';
import type { AppMode } from '@dustnote/shared';

export function ModeSelectScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const setMode = useModeStore((s) => s.setMode);
  const setServerUrl = useModeStore((s) => s.setServerUrl);
  const initialize = useModeStore((s) => s.initialize);

  const [selected, setSelected] = useState<AppMode | null>(null);
  const [serverUrl, setServerUrlInput] = useState('');
  const [testing, setTesting] = useState(false);

  const onSelectStandalone = () => {
    setSelected('standalone');
    setServerUrlInput('');
  };

  const onSelectOnline = () => {
    setSelected('online');
  };

  const onTestConnection = async () => {
    const trimmed = serverUrl.trim();
    if (!trimmed) {
      Alert.alert(t('common.hint'), t('mode_select.err_empty_server'));
      return;
    }
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      Alert.alert(t('common.hint'), '地址需以 http:// 或 https:// 开头');
      return;
    }
    setTesting(true);
    try {
      // 临时写入 store，让 api 拦截器使用新 baseUrl
      setServerUrl(trimmed);
      // 使用 AbortController 添加 10s 超时
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const r = await api.get<{ initialized: boolean }>('/auth/status');
        clearTimeout(timer);
        Alert.alert(
          t('mode_select.connection_ok'),
          t('mode_select.connection_ok_detail', { yesno: r.initialized ? t('common.ok') : '—' })
        );
      } catch (err) {
        clearTimeout(timer);
        const msg = (err as Error).message;
        if (msg?.includes('abort') || msg?.includes('timeout')) {
          Alert.alert(t('mode_select.connection_failed'), '连接超时（10秒），请检查地址和网络');
        } else if (msg?.includes('fetch') || msg?.includes('network') || msg?.includes('Network')) {
          Alert.alert(t('mode_select.connection_failed'), '网络不可达，请检查地址是否正确');
        } else {
          Alert.alert(t('mode_select.connection_failed'), msg || '未知错误');
        }
      }
    } finally {
      setTesting(false);
    }
  };

  const onConfirm = () => {
    if (!selected) {
      Alert.alert(t('common.hint'), t('mode_select.err_no_mode'));
      return;
    }
    if (selected === 'online' && !serverUrl.trim()) {
      Alert.alert(t('common.hint'), t('mode_select.err_no_server'));
      return;
    }
    setMode(selected);
    if (selected === 'online') {
      setServerUrl(serverUrl.trim());
    } else {
      setServerUrl(null);
    }
    initialize();
    // App.tsx 会监听 modeStore.initialized 变化，自动路由到鉴权页
  };

  const styles = makeStyles(colors);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Image source={logoImage} style={styles.logo} />
      <Text style={styles.title}>{t('mode_select.welcome')}</Text>
      <Text style={styles.subtitle}>{t('mode_select.subtitle')}</Text>

      {/* 单机模式卡片 */}
      <TouchableOpacity
        style={[styles.card, selected === 'standalone' && styles.cardActive]}
        onPress={onSelectStandalone}
      >
        <Text style={styles.cardEmoji}>📱</Text>
        <Text style={styles.cardTitle}>{t('mode_select.standalone_title')}</Text>
        <Text style={styles.cardDesc}>{t('mode_select.standalone_desc')}</Text>
        <Text style={styles.cardFeatures}>{t('mode_select.standalone_features')}</Text>
      </TouchableOpacity>

      {/* 联机模式卡片 */}
      <TouchableOpacity
        style={[styles.card, selected === 'online' && styles.cardActive]}
        onPress={onSelectOnline}
      >
        <Text style={styles.cardEmoji}>🌐</Text>
        <Text style={styles.cardTitle}>{t('mode_select.online_title')}</Text>
        <Text style={styles.cardDesc}>{t('mode_select.online_desc')}</Text>
        <Text style={styles.cardFeatures}>{t('mode_select.online_features')}</Text>
      </TouchableOpacity>

      {/* 联机模式：服务器地址输入 */}
      {selected === 'online' && (
        <View style={styles.serverSection}>
          <Text style={styles.serverLabel}>{t('mode_select.server_url')}</Text>
          <TextInput
            style={styles.serverInput}
            placeholder={t('mode_select.server_url_placeholder')}
            value={serverUrl}
            onChangeText={setServerUrlInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholderTextColor={colors.muted}
          />
          <TouchableOpacity
            style={[styles.testButton, testing && { opacity: 0.5 }]}
            disabled={testing}
            onPress={onTestConnection}
          >
            {testing ? (
              <ActivityIndicator size="small" color={colors.mint600} />
            ) : (
              <Text style={styles.testButtonText}>{t('mode_select.test_connection')}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={[styles.confirmButton, !selected && { opacity: 0.5 }]}
        disabled={!selected}
        onPress={onConfirm}
      >
        <Text style={styles.confirmButtonText}>
          {selected === 'online' ? t('mode_select.confirm') : t('mode_select.confirm_standalone')}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      flexGrow: 1,
      padding: 24,
      backgroundColor: c.bg,
    },
    emoji: { fontSize: 56, textAlign: 'center', marginTop: 32, marginBottom: 12 },
    logo: { width: 56, height: 56, alignSelf: 'center', marginTop: 32, marginBottom: 12 },
    title: {
      fontSize: 24,
      fontWeight: '700',
      textAlign: 'center',
      color: c.fg,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 14,
      color: c.muted,
      textAlign: 'center',
      marginBottom: 24,
    },
    card: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
    },
    cardActive: {
      borderColor: c.mint600,
      borderWidth: 2,
      backgroundColor: c.mint50,
    },
    cardEmoji: { fontSize: 32, marginBottom: 8 },
    cardTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: c.fg,
      marginBottom: 4,
    },
    cardDesc: {
      fontSize: 13,
      color: c.muted,
      lineHeight: 18,
      marginBottom: 8,
    },
    cardFeatures: {
      fontSize: 12,
      color: c.mint700,
      fontWeight: '500',
    },
    serverSection: {
      marginBottom: 16,
    },
    serverLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: c.fg,
      marginBottom: 6,
    },
    serverInput: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      fontSize: 15,
      color: c.fg,
      marginBottom: 8,
    },
    testButton: {
      padding: 10,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: c.mint600,
      alignItems: 'center',
    },
    testButtonText: {
      color: c.mint600,
      fontSize: 13,
      fontWeight: '600',
    },
    confirmButton: {
      backgroundColor: c.mint600,
      borderRadius: 8,
      padding: 16,
      alignItems: 'center',
      marginTop: 16,
    },
    confirmButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
    },
  });
}
