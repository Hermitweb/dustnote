/**
 * 解锁页
 *
 * 支持两种解锁方式：
 * - 主密码解锁：调用 /auth/unlock，派生 masterKey
 * - 生物识别解锁：通过 simplePrompt 验证指纹 / 面容后，从 keychain 读取缓存的
 *   masterKey 直接进入已解锁状态
 */

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import ReactNativeBiometrics from 'react-native-biometrics';
import { useAuthStore } from '../state/auth';
import { useColors } from '../theme';

const rnb = new ReactNativeBiometrics();

export function UnlockScreen() {
  const colors = useColors();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const unlock = useAuthStore((s) => s.unlock);
  const unlockWithBiometric = useAuthStore((s) => s.unlockWithBiometric);
  const hasBiometricCache = useAuthStore((s) => s.hasBiometricCache);

  const onUnlock = async () => {
    setSubmitting(true);
    try {
      await unlock(password);
    } catch (err) {
      Alert.alert('解锁失败', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const onBiometric = async () => {
    try {
      const { available } = await rnb.isSensorAvailable();
      if (!available) {
        Alert.alert('不可用', '设备未配置生物识别');
        return;
      }
      // 先用 simplePrompt 让用户确认指纹 / 面容
      const { success } = await rnb.simplePrompt({ promptMessage: '解锁 DustNote' });
      if (!success) return;
      // 生物识别通过：从 keychain 读取缓存的 masterKey
      const ok = await unlockWithBiometric();
      if (!ok) {
        Alert.alert('提示', '未找到缓存的解锁信息，请输入主密码完成解锁');
      }
    } catch (err) {
      Alert.alert('解锁失败', (err as Error).message);
    }
  };

  const styles = makeStyles(colors);

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🌿</Text>
      <Text style={styles.title}>DustNote</Text>
      <Text style={styles.subtitle}>输入主密码解锁</Text>

      <TextInput
        style={styles.input}
        placeholder="主密码"
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
        <Text style={styles.buttonText}>{submitting ? '解锁中…' : '解锁'}</Text>
      </TouchableOpacity>

      {hasBiometricCache && (
        <TouchableOpacity style={styles.bioButton} onPress={onBiometric}>
          <Text style={styles.bioButtonText}>👆 使用生物识别</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// 根据当前颜色生成样式；仅在 isDark 变化时重新创建
function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: c.bg },
    emoji: { fontSize: 64, textAlign: 'center', marginBottom: 16 },
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
  });
}
