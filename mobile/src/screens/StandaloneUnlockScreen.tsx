/**
 * 单机模式：解锁（v2.0.0）
 *
 * 流程：
 * 1. 检查本地 lockoutState，若锁定中显示剩余倒计时
 * 2. 用户输入主密码 → 调用 unlockLocalAuth 校验
 *    或通过生物识别 → 从 keychain 读取缓存的 masterKey
 * 3. 失败：累加 failedAttempts，达到 6 次后锁定 15 分钟
 * 4. 成功：重置失败计数，解封 masterKey 进入已解锁状态
 *
 * 与联机模式的区别：
 * - 无服务端调用，纯本地校验
 * - 锁定状态在客户端持久化（AsyncStorage）
 * - 生物识别仅缓存 masterKey（无 access token）
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Image } from 'react-native';
import logoImage from '../assets/logo.png';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ReactNativeBiometrics from 'react-native-biometrics';
import type { RootStackParamList } from '../App';
import { useAuthStore } from '../state/auth';
import { useColors } from '../theme';
import { LOCAL_LOCKOUT_DURATION_MS } from '@dustnote/shared';

const rnb = new ReactNativeBiometrics();

export function StandaloneUnlockScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const colors = useColors();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [remainingSec, setRemainingSec] = useState(0);

  const unlockStandalone = useAuthStore((s) => s.unlockStandalone);
  const unlockStandaloneWithBiometric = useAuthStore((s) => s.unlockStandaloneWithBiometric);
  const getRemainingLockoutMs = useAuthStore((s) => s.getRemainingLockoutMs);
  const lockoutState = useAuthStore((s) => s.lockoutState);
  const hasBiometricCache = useAuthStore((s) => s.hasBiometricCache);

  // 锁定中时显示倒计时
  useEffect(() => {
    const update = () => {
      const ms = getRemainingLockoutMs();
      setRemainingSec(Math.ceil(ms / 1000));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [lockoutState, getRemainingLockoutMs]);

  const isLocked = remainingSec > 0;

  const onUnlock = async () => {
    if (isLocked) {
      Alert.alert('账号已锁定', `请 ${remainingSec} 秒后重试`);
      return;
    }
    setSubmitting(true);
    // 让 UI 先渲染 "解锁中..." 状态，避免 Argon2id 同步阻塞主线程时用户看不到反馈
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      await unlockStandalone(password);
      // store 切换到 unlocked 状态后，App.tsx 会自动路由到主界面
    } catch (err) {
      Alert.alert('解锁失败', (err as Error).message);
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  const onBiometric = async () => {
    if (isLocked) {
      Alert.alert('账号已锁定', `请 ${remainingSec} 秒后重试`);
      return;
    }
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
      const ok = await unlockStandaloneWithBiometric();
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
      <Image source={logoImage} style={styles.logo} />
      <Text style={styles.title}>DustNote（单机）</Text>
      <Text style={styles.subtitle}>
        {isLocked
          ? `账号已锁定，请 ${remainingSec} 秒后重试`
          : '输入主密码解锁本地笔记'}
      </Text>

      <TextInput
        style={[styles.input, isLocked && { opacity: 0.5 }]}
        placeholder="主密码"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        autoFocus
        editable={!isLocked}
        onSubmitEditing={onUnlock}
        placeholderTextColor={colors.muted}
      />

      <TouchableOpacity
        style={[styles.button, (submitting || isLocked) && { opacity: 0.5 }]}
        disabled={submitting || isLocked}
        onPress={onUnlock}
      >
        <Text style={styles.buttonText}>{submitting ? '解锁中…' : '解锁'}</Text>
      </TouchableOpacity>

      {hasBiometricCache && !isLocked && (
        <TouchableOpacity style={styles.bioButton} onPress={onBiometric}>
          <Text style={styles.bioButtonText}>👆 使用生物识别</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.recoverButton}
        onPress={() => navigation.navigate('StandaloneRecover' as never)}
      >
        <Text style={styles.recoverButtonText}>使用恢复码重置密码</Text>
      </TouchableOpacity>

      {isLocked && (
        <Text style={styles.lockedHint}>
          连续 6 次密码错误，账号已锁定 {LOCAL_LOCKOUT_DURATION_MS / 60000} 分钟
        </Text>
      )}
    </View>
  );
}

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
    bioButton: { marginTop: 12, padding: 12, alignItems: 'center' },
    bioButtonText: { color: c.mint600, fontSize: 14 },
    recoverButton: { marginTop: 16, padding: 12, alignItems: 'center' },
    recoverButtonText: { color: c.mint600, fontSize: 14 },
    lockedHint: {
      marginTop: 16,
      fontSize: 12,
      color: c.muted,
      textAlign: 'center',
      lineHeight: 18,
    },
  });
}
