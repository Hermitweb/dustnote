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
} from 'react-native';
import { useAuthStore } from '../state/auth';
import { useColors } from '../theme';

export function StandaloneSetupScreen() {
  const colors = useColors();
  const setupStandalone = useAuthStore((s) => s.setupStandalone);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const strength = (() => {
    if (password.length < 8) return { level: 0, text: '至少 8 位' };
    if (password.length < 12) return { level: 1, text: '弱' };
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password))
      return { level: 2, text: '中等' };
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
    // 诊断：检查 crypto.subtle 是否就绪（v2.3.5 新增）
    // 如果 polyfill 加载失败，global.crypto.subtle 会是 undefined
    if (typeof global.crypto === 'undefined' || !global.crypto.subtle) {
      // @ts-ignore - 诊断全局变量
      const st = globalThis.__QCRYPTO_STATUS || {};
      Alert.alert(
        '加密模块未就绪',
        'crypto.subtle 不可用，无法进行加密操作。\n\n' +
          '诊断信息：\n' +
          `global.crypto: ${typeof global.crypto}\n` +
          `crypto.subtle: ${global.crypto ? typeof global.crypto.subtle : 'N/A'}\n` +
          `requireOk: ${st.requireOk}\n` +
          `hasInstall: ${st.hasInstall}\n` +
          `installOk: ${st.installOk}\n` +
          `requireError: ${st.requireError ?? '无'}\n` +
          `installError: ${st.installError ?? '无'}\n\n` +
          '请重启应用；若仍失败请重新安装。'
      );
      return;
    }
    setSubmitting(true);
    // 让 UI 先渲染 "设置中..." 状态，避免 Argon2id 同步阻塞主线程时用户看不到反馈。
    // Argon2id 在 @noble/hashes 中是纯 JS 同步实现，会阻塞 Hermes 主线程几秒，
    // 必须先让 React 完成一次渲染，用户才知道按钮被触发了。
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      console.log('[DustNote] setupStandalone start, pwd len=' + password.length);
      const t0 = Date.now();
      const code = await setupStandalone(password);
      console.log('[DustNote] setupStandalone done in ' + (Date.now() - t0) + 'ms');
      setRecoveryCode(code);
    } catch (err) {
      console.error('[DustNote] setupStandalone failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack ?? '' : '';
      Alert.alert('设置失败', `${msg}\n\n${stack.slice(0, 500)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const styles = makeStyles(colors);

  if (recoveryCode) {
    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>🔑</Text>
        <Text style={styles.title}>保存恢复码</Text>
        <Text style={styles.subtitle}>
          忘记主密码时唯一的找回方式。请抄写在纸上或保存到密码管理器。
          {'\n'}⚠️ 恢复码仅显示一次，丢失后笔记将永久无法找回。
        </Text>
        <View style={styles.codeBox}>
          <Text style={styles.codeText}>{recoveryCode}</Text>
        </View>
        <Text style={styles.hint}>
          恢复后主密码会重置，但已加密的笔记可继续解密（masterKey 保留）。
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => {
            /* store 已切换到 unlocked 状态，App.tsx 会自动路由到主界面 */
          }}
        >
          <Text style={styles.buttonText}>我已保存，继续</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.emoji}>🌿</Text>
      <Text style={styles.title}>创建主密码（单机模式）</Text>
      <Text style={styles.subtitle}>
        主密码用于加密本地存储的所有笔记。我们无法找回，请妥善保管。
      </Text>

      <TextInput
        style={styles.input}
        placeholder="主密码（至少 8 位）"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        placeholderTextColor={colors.muted}
      />
      <TextInput
        style={styles.input}
        placeholder="再次输入主密码"
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
        <Text style={styles.buttonText}>{submitting ? '设置中…' : '创建笔记空间'}</Text>
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
