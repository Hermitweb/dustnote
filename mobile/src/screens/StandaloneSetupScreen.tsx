/**
 * 单机模式：首次设置主密码（v2.0.0）
 *
 * 流程：
 * 1. 用户输入主密码（>= 8 字符）+ 确认
 * 2. 调用 setupLocalAuth 生成 LocalAuthBlob（包含随机 masterKey + 双重包装）
 * 3. 持久化 blob 到 AsyncStorage
 * 4. 显示一次性恢复码（用户需截图保存）
 * 5. 进入已解锁状态
 *
 * 安全提示：
 * - masterKey 随机生成（不从密码派生），recover 后可保留
 * - 恢复码仅显示一次，丢失后无法找回
 * - 主密码不存储明文，仅存 Argon2id 校验值
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
  Image,
} from 'react-native';
import logoImage from '../assets/logo.png';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../state/auth';
import { useColors } from '../theme';

export function StandaloneSetupScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const setupStandalone = useAuthStore((s) => s.setupStandalone);
  const confirmSetupComplete = useAuthStore((s) => s.confirmSetupComplete);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const strength = (() => {
    if (password.length < 6) return { level: 0, text: t('auth.strength_min8') };
    if (password.length < 12) return { level: 1, text: t('auth.strength_weak') };
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password))
      return { level: 2, text: t('auth.strength_medium') };
    if (password.length >= 16) return { level: 4, text: t('auth.strength_strong') };
    return { level: 3, text: t('auth.strength_good') };
  })();

  const onSubmit = async () => {
    if (password.length < 6) {
      Alert.alert(t('common.error'), t('auth.too_weak'));
      return;
    }
    if (password !== confirm) {
      Alert.alert(t('common.error'), t('auth.mismatch'));
      return;
    }
    // 诊断：检查 crypto.subtle 是否就绪（v2.3.5 新增）
    // 如果 polyfill 加载失败，global.crypto.subtle 会是 undefined
    if (typeof global.crypto === 'undefined' || !global.crypto.subtle) {
      const st =
        (globalThis as { __QCRYPTO_STATUS?: Record<string, unknown> }).__QCRYPTO_STATUS || {};
      Alert.alert(
        t('auth.crypto_not_ready'),
        t('auth.crypto_not_ready_detail', {
          cryptoType: typeof global.crypto,
          subtleType: global.crypto ? typeof global.crypto.subtle : 'N/A',
          requireOk: String(st.requireOk),
          installOk: String(st.installOk),
          requireError: st.requireError != null ? String(st.requireError) : t('common.none'),
          installError: st.installError != null ? String(st.installError) : t('common.none'),
        })
      );
      return;
    }
    setSubmitting(true);
    // 让 UI 先渲染 "设置中..." 状态，避免 Argon2id 同步阻塞主线程时用户看不到反馈。
    // Argon2id 在 @noble/hashes 中是纯 JS 同步实现，会阻塞 Hermes 主线程几秒，
    // 必须先让 React 完成一次渲染，用户才知道按钮被触发了。
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const code = await setupStandalone(password);
      setRecoveryCode(code);
    } catch (err) {
      console.error('[DustNote] setupStandalone failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert(t('auth.setup_failed'), msg);
    } finally {
      setSubmitting(false);
    }
  };

  const styles = makeStyles(colors);

  if (recoveryCode) {
    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>🔑</Text>
        <Text style={styles.title}>{t('auth.recovery_save_title')}</Text>
        <Text style={styles.subtitle}>{t('auth.recovery_save_subtitle')}</Text>
        <View style={styles.codeBox}>
          <Text style={styles.codeText}>{recoveryCode}</Text>
        </View>
        <Text style={styles.hint}>{t('auth.recovery_save_hint')}</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => {
            // setupStandalone 未设 authState='unlocked'，此处由用户确认后手动触发
            confirmSetupComplete();
          }}
        >
          <Text style={styles.buttonText}>{t('auth.recovery_save_btn')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Image source={logoImage} style={styles.logo} />
      <Text style={styles.title}>{t('auth.standalone_setup_title')}</Text>
      <Text style={styles.subtitle}>{t('auth.standalone_setup_subtitle')}</Text>

      <TextInput
        style={styles.input}
        placeholder={t('auth.password_placeholder')}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        placeholderTextColor={colors.muted}
      />
      <TextInput
        style={styles.input}
        placeholder={t('auth.confirm_password_placeholder')}
        secureTextEntry
        value={confirm}
        onChangeText={setConfirm}
        placeholderTextColor={colors.muted}
      />

      <View style={styles.strengthBar}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View
            key={i}
            style={[
              styles.strengthCell,
              { backgroundColor: i < strength.level ? colors.mint600 : colors.border },
            ]}
          />
        ))}
        <Text style={styles.strengthText}>{strength.text}</Text>
      </View>

      <TouchableOpacity
        style={[styles.button, submitting && { opacity: 0.5 }]}
        disabled={submitting}
        onPress={onSubmit}
      >
        <Text style={styles.buttonText}>
          {submitting ? t('auth.creating') : t('auth.setup_btn')}
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
      justifyContent: 'center',
      backgroundColor: c.bg,
    },
    emoji: { fontSize: 64, textAlign: 'center', marginBottom: 16 },
    logo: { width: 64, height: 64, alignSelf: 'center', marginBottom: 16 },
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
      lineHeight: 20,
    },
    hint: {
      fontSize: 12,
      color: c.muted,
      textAlign: 'center',
      marginBottom: 16,
      lineHeight: 18,
    },
    input: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 14,
      fontSize: 16,
      marginBottom: 12,
      color: c.fg,
    },
    strengthBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
    strengthCell: { width: 36, height: 4, borderRadius: 2, marginRight: 4 },
    strengthText: { fontSize: 12, color: c.muted, marginLeft: 8 },
    button: {
      backgroundColor: c.mint600,
      borderRadius: 8,
      padding: 16,
      alignItems: 'center',
    },
    buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
    codeBox: {
      backgroundColor: c.mint50,
      borderRadius: 8,
      padding: 24,
      marginVertical: 24,
      alignItems: 'center',
    },
    codeText: {
      fontSize: 32,
      fontWeight: '700',
      color: c.mint700,
      letterSpacing: 8,
    },
  });
}
