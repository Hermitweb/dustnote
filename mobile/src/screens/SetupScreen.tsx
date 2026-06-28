/**
 * 首次创建主密码
 */

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useAuthStore } from '../state/auth';
import { theme } from '../theme';

export function SetupScreen() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const setup = useAuthStore((s) => s.setup);

  const strength = (() => {
    if (password.length < 8) return { level: 0, text: '至少 8 位' };
    if (password.length < 12) return { level: 1, text: '弱' };
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) return { level: 2, text: '中等' };
    if (password.length >= 16) return { level: 4, text: '强' };
    return { level: 3, text: '良好' };
  })();

  const onSubmit = async () => {
    if (password.length < 8) {
      Alert.alert('错误', '密码至少 8 位');
      return;
    }
    if (password !== confirm) {
      Alert.alert('错误', '两次密码不一致');
      return;
    }
    setSubmitting(true);
    try {
      const code = await setup(password);
      setRecoveryCode(code);
    } catch (err) {
      Alert.alert('设置失败', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (recoveryCode) {
    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>🔑</Text>
        <Text style={styles.title}>保存恢复码</Text>
        <Text style={styles.subtitle}>
          忘记密码时唯一找回方式。请抄写在纸上或保存到密码管理器。
        </Text>
        <View style={styles.codeBox}>
          <Text style={styles.codeText}>{recoveryCode}</Text>
        </View>
        <TouchableOpacity style={styles.button} onPress={() => setRecoveryCode(null)}>
          <Text style={styles.buttonText}>我已保存，继续</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.emoji}>🌿</Text>
      <Text style={styles.title}>创建主密码</Text>
      <Text style={styles.subtitle}>
        主密码是您访问笔记的唯一凭据。我们无法找回，请妥善保管。
      </Text>

      <TextInput
        style={styles.input}
        placeholder="主密码（至少 8 位）"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <TextInput
        style={styles.input}
        placeholder="再次输入主密码"
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
        <Text style={styles.buttonText}>{submitting ? '设置中…' : '下一步'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, justifyContent: 'center', backgroundColor: theme.bgLight },
  emoji: { fontSize: 64, textAlign: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', color: theme.fgLight, marginBottom: 8 },
  subtitle: { fontSize: 14, color: theme.mutedLight, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
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
