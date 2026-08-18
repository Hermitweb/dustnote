/**
 * 解锁页
 *
 * 支持两种解锁方式：
 * - 主密码解锁：调用 /auth/unlock，派生 masterKey
 * - 生物识别解锁：通过 simplePrompt 验证指纹 / 面容后，从 keychain 读取缓存的
 *   masterKey 直接进入已解锁状态
 */

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Image } from 'react-native';
import logoImage from '../assets/logo.png';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';
import ReactNativeBiometrics from 'react-native-biometrics';
import { useAuthStore } from '../state/auth';
import { useColors } from '../theme';

const rnb = new ReactNativeBiometrics();

export function UnlockScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const unlock = useAuthStore((s) => s.unlock);
  const unlockWithBiometric = useAuthStore((s) => s.unlockWithBiometric);
  const hasBiometricCache = useAuthStore((s) => s.hasBiometricCache);

  const onUnlock = async () => {
    // 空密码不提交，避免浪费服务端失败计数配额（连续错误会触发账号锁定）
    if (!password.trim()) {
      Alert.alert(t('common.hint'), t('auth.password_required'));
      return;
    }
    setSubmitting(true);
    try {
      await unlock(password);
    } catch (err) {
      Alert.alert(t('auth.unlock_failed'), (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const onBiometric = async () => {
    try {
      const { available } = await rnb.isSensorAvailable();
      if (!available) {
        Alert.alert(t('common.hint'), t('auth.unlock_biometric_unavailable'));
        return;
      }
      // 先用 simplePrompt 让用户确认指纹 / 面容
      const { success } = await rnb.simplePrompt({ promptMessage: t('auth.unlock_biometric_prompt') });
      if (!success) return;
      // 生物识别通过：从 keychain 读取缓存的 masterKey
      const ok = await unlockWithBiometric();
      if (!ok) {
        Alert.alert(t('common.hint'), t('auth.unlock_biometric_no_cache'));
      }
    } catch (err) {
      Alert.alert(t('auth.unlock_failed'), (err as Error).message);
    }
  };

  const styles = makeStyles(colors);

  return (
    <View style={styles.container}>
      <Image source={logoImage} style={styles.logo} />
      <Text style={styles.title}>{t('auth.unlock_title')}</Text>
      <Text style={styles.subtitle}>{t('auth.unlock_subtitle')}</Text>

      <TextInput
        style={styles.input}
        placeholder={t('auth.unlock_password')}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        autoFocus
        onSubmitEditing={onUnlock}
        placeholderTextColor={colors.muted}
      />

      <TouchableOpacity
        style={[styles.button, submitting && { opacity: 0.5 }]}
        disabled={submitting}
        onPress={onUnlock}
      >
        <Text style={styles.buttonText}>{submitting ? t('auth.unlocking') : t('auth.unlock_btn')}</Text>
      </TouchableOpacity>

      {hasBiometricCache && (
        <TouchableOpacity style={styles.bioButton} onPress={onBiometric}>
          <Text style={styles.bioButtonText}>{t('auth.unlock_biometric')}</Text>
        </TouchableOpacity>
      )}

      {/* 忘记密码：用恢复码找回 */}
      <TouchableOpacity
        style={styles.recoverButton}
        onPress={() => navigation.navigate('OnlineRecover')}
      >
        <Text style={styles.recoverButtonText}>{t('auth.recover_forgot')}</Text>
      </TouchableOpacity>
    </View>
  );
}

// 根据当前颜色生成样式；仅在 isDark 变化时重新创建
function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: c.bg },
    emoji: { fontSize: 64, textAlign: 'center', marginBottom: 16 },
    logo: { width: 64, height: 64, alignSelf: 'center', marginBottom: 16 },
    title: {
      fontSize: 28,
      fontWeight: '700',
      textAlign: 'center',
      color: c.mint700,
      marginBottom: 8,
    },
    subtitle: { fontSize: 14, color: c.muted, textAlign: 'center', marginBottom: 24 },
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
      marginTop: 8,
    },
    buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
    bioButton: { marginTop: 16, padding: 12, alignItems: 'center' },
    bioButtonText: { color: c.mint600, fontSize: 14 },
    recoverButton: { marginTop: 8, padding: 12, alignItems: 'center' },
    recoverButtonText: { color: c.muted, fontSize: 13, textDecorationLine: 'underline' },
  });
}
