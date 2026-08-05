/**
 * 联机模式：恢复码重置密码
 *
 * 流程（与 web 端 store.recover 一致）：
 * 1. GET /auth/recovery-params 取 rc_salt
 * 2. 用恢复码派生 recoveryKek，POST /auth/recover 取回服务端包装的 masterKey
 * 3. 解封 masterKey（历史笔记照常可解），用新密码重新包装
 * 4. POST /auth/rewrap 上传新包装 → 进入已解锁状态
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
import { useAuthStore } from '../state/auth';
import { useColors } from '../theme';

export function OnlineRecoverScreen() {
  const colors = useColors();
  const recoverOnline = useAuthStore((s) => s.recoverOnline);

  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async () => {
    if (!isValidRecoveryCode(recoveryCode)) {
      Alert.alert('错误', '恢复码格式不正确（应为 XXXXX-XXXXX）');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('错误', '新密码至少 8 位');
      return;
    }
    if (newPassword !== confirm) {
      Alert.alert('错误', '两次密码不一致');
      return;
    }
    setSubmitting(true);
    try {
      await recoverOnline(recoveryCode, newPassword);
      // recoverOnline 已把 authState 置为 unlocked，App.tsx 会自动路由到主界面
      setDone(true);
    } catch (err) {
      Alert.alert('恢复失败', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const styles = makeStyles(colors);

  if (done) {
    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>✅</Text>
        <Text style={styles.title}>密码已重置</Text>
        <Text style={styles.subtitle}>
          已用新主密码重新包装 masterKey，原有笔记全部可正常解密。{'\n'}即将进入应用…
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.emoji}>🔄</Text>
      <Text style={styles.title}>恢复码重置密码</Text>
      <Text style={styles.subtitle}>
        输入你的 10 位恢复码和新主密码。{'\n'}恢复后 masterKey 保留，已有笔记可继续解密。
      </Text>

      <TextInput
        style={styles.input}
        placeholder="恢复码 (XXXXX-XXXXX)"
        autoCapitalize="characters"
        maxLength={16}
        value={recoveryCode}
        onChangeText={setRecoveryCode}
        placeholderTextColor={colors.muted}
      />
      <TextInput
        style={styles.input}
        placeholder="新主密码（至少 8 位）"
        secureTextEntry
        value={newPassword}
        onChangeText={setNewPassword}
        placeholderTextColor={colors.muted}
      />
      <TextInput
        style={styles.input}
        placeholder="再次输入新主密码"
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
        <Text style={styles.buttonText}>{submitting ? '恢复中…' : '重置密码'}</Text>
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
  });
}
