/**
 * 单机模式：解锁（v2.0.0）
 *
 * 流程：
 * 1. 检查本地 lockoutState，若锁定中显示剩余倒计时
 * 2. 用户输入主密码 → 调用 unlockLocalAuth 校验
 * 3. 失败：累加 failedAttempts，达到 6 次后锁定 15 分钟
 * 4. 成功：重置失败计数，解封 masterKey 进入已解锁状态
 *
 * 与联机模式的区别：
 * - 无服务端调用，纯本地校验
 * - 锁定状态在客户端持久化（AsyncStorage）
 * - 无生物识别缓存（单机模式 masterKey 不固定，刷新后清空）
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';
import { useAuthStore } from '../state/auth';
import { useColors } from '../theme';
import { LOCAL_LOCKOUT_DURATION_MS } from '@dustnote/shared';

export function StandaloneUnlockScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const colors = useColors();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [remainingSec, setRemainingSec] = useState(0);

  const unlockStandalone = useAuthStore((s) => s.unlockStandalone);
  const getRemainingLockoutMs = useAuthStore((s) => s.getRemainingLockoutMs);
  const lockoutState = useAuthStore((s) => s.lockoutState);

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

  const styles = makeStyles(colors);

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🌿</Text>
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
