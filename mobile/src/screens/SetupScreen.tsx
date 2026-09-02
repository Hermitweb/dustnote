/**
 * 首次创建主密码
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
import Clipboard from '@react-native-clipboard/clipboard';
import logoImage from '../assets/logo.png';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../state/auth';
import { theme, useColors } from '../theme';

export function SetupScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const setup = useAuthStore((s) => s.setup);
  const confirmSetupComplete = useAuthStore((s) => s.confirmSetupComplete);

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
    setSubmitting(true);
    try {
      const code = await setup(password);
      setRecoveryCode(code);
    } catch (err) {
      Alert.alert(t('auth.setup_failed'), (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (recoveryCode) {
    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>🔑</Text>
        <Text style={styles.title}>{t('auth.recovery_save_title')}</Text>
        <Text style={styles.subtitle}>{t('auth.recovery_save_subtitle_online')}</Text>
        <View style={styles.codeBox}>
          <Text style={styles.codeText}>{recoveryCode}</Text>
        </View>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }]}
          onPress={() => {
            // FLAG_SECURE 全局禁截屏（security.md §3.6），截图保存不可行——
            // 提供复制到剪贴板作为替代保存方式
            Clipboard.setString(recoveryCode);
            Alert.alert(t('common.copied'), t('auth.code_copied_detail'));
          }}
        >
          <Text style={[styles.buttonText, { color: colors.mint600 }]}>{t('auth.copy_code_btn')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.button}
          onPress={() => {
            // setup 未设 authState='unlocked'，此处由用户确认后手动触发
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
      <Text style={styles.title}>{t('auth.online_setup_title')}</Text>
      <Text style={styles.subtitle}>{t('auth.online_setup_subtitle')}</Text>

      <TextInput
        style={styles.input}
        placeholder={t('auth.password_placeholder')}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <TextInput
        style={styles.input}
        placeholder={t('auth.confirm_password_placeholder')}
        secureTextEntry
        value={confirm}
        onChangeText={setConfirm}
      />

      <View style={styles.strengthBar}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View
            key={i}
            style={[
              styles.strengthCell,
              { backgroundColor: i < strength.level ? theme.mint600 : theme.borderLight },
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
          {submitting ? t('auth.creating') : t('auth.next_btn')}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, justifyContent: 'center', backgroundColor: theme.bgLight },
  emoji: { fontSize: 64, textAlign: 'center', marginBottom: 16 },
  logo: { width: 64, height: 64, alignSelf: 'center', marginBottom: 16 },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    color: theme.fgLight,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: theme.mutedLight,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  input: {
    backgroundColor: theme.cardLight,
    borderColor: theme.borderLight,
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
    color: theme.fgLight,
  },
  strengthBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  strengthCell: { width: 36, height: 4, borderRadius: 2, marginRight: 4 },
  strengthText: { fontSize: 12, color: theme.mutedLight, marginLeft: 8 },
  button: { backgroundColor: theme.mint600, borderRadius: 8, padding: 16, alignItems: 'center' },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  codeBox: {
    backgroundColor: theme.mint50,
    borderRadius: 8,
    padding: 24,
    marginVertical: 24,
    alignItems: 'center',
  },
  codeText: { fontSize: 32, fontWeight: '700', color: theme.mint700, letterSpacing: 8 },
});
