/**
 * 单机模式：恢复码重置密码（v2.0.0）
 *
 * 流程：
 * 1. 用户输入 10 位恢复码 + 新主密码
 * 2. 调用 recoverLocalAuth 校验恢复码并解封原始 masterKey
 * 3. 用新密码重新包装原始 masterKey（masterKey 不变，已有笔记可继续解密）
 * 4. 生成新恢复码并显示（旧恢复码失效）
 *
 * 安全保证：
 * - 恢复码仅本地校验（Argon2id 弱参数），不联网
 * - recover 后 masterKey 保留，所有已加密笔记无需迁移即可继续解密
 * - 旧恢复码失效，必须保存新恢复码
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
} from 'react-native';
import { isValidRecoveryCode } from '@dustnote/shared';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../state/auth';
import { useColors } from '../theme';

export function StandaloneRecoverScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const recoverStandalone = useAuthStore((s) => s.recoverStandalone);
  const confirmSetupComplete = useAuthStore((s) => s.confirmSetupComplete);

  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!isValidRecoveryCode(recoveryCode)) {
      Alert.alert(t('common.error'), t('auth.recover_code_invalid'));
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert(t('common.error'), t('auth.too_weak'));
      return;
    }
    if (newPassword !== confirm) {
      Alert.alert(t('common.error'), t('auth.mismatch'));
      return;
    }
    setSubmitting(true);
    try {
      const code = await recoverStandalone(recoveryCode, newPassword);
      setNewRecoveryCode(code);
    } catch (err) {
      Alert.alert(t('auth.recover_failed'), (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const styles = makeStyles(colors);

  if (newRecoveryCode) {
    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>🔑</Text>
        <Text style={styles.title}>{t('auth.recovered_title')}</Text>
        <Text style={styles.subtitle}>{t('auth.recovered_subtitle')}</Text>
        <View style={styles.codeBox}>
          <Text style={styles.codeText}>{newRecoveryCode}</Text>
        </View>
        <Text style={styles.hint}>{t('auth.recovered_hint')}</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => {
            // recoverStandalone 未设 authState='unlocked'，此处由用户确认后手动触发
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
      <Text style={styles.emoji}>🔄</Text>
      <Text style={styles.title}>{t('auth.recover_title')}</Text>
      <Text style={styles.subtitle}>{t('auth.recover_screen_subtitle')}</Text>

      <TextInput
        style={styles.input}
        placeholder={t('auth.recover_code_placeholder')}
        autoCapitalize="characters"
        maxLength={16}
        value={recoveryCode}
        onChangeText={setRecoveryCode}
        placeholderTextColor={colors.muted}
      />
      <TextInput
        style={styles.input}
        placeholder={t('auth.new_password_placeholder')}
        secureTextEntry
        value={newPassword}
        onChangeText={setNewPassword}
        placeholderTextColor={colors.muted}
      />
      <TextInput
        style={styles.input}
        placeholder={t('auth.confirm_new_password_placeholder')}
        secureTextEntry
        value={confirm}
        onChangeText={setConfirm}
        placeholderTextColor={colors.muted}
      />

      <TouchableOpacity
        style={[styles.button, submitting && { opacity: 0.5 }]}
        disabled={submitting}
        onPress={onSubmit}
      >
        <Text style={styles.buttonText}>
          {submitting ? t('auth.recovering') : t('auth.recover_btn')}
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
