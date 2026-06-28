/**
 * 小程序首次设置：创建主密码 + 生成恢复码
 * 接入 E2EE：调用 store.setup 完成 masterKey 派生与包装
 */
import React, { useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAuthStore } from '../../state/auth';

type Strength = { label: string; level: 'weak' | 'medium' | 'strong'; width: number };

function evalStrength(p: string): Strength {
  if (p.length < 8) return { label: '弱', level: 'weak', width: 25 };
  if (p.length < 12) return { label: '中等', level: 'medium', width: 60 };
  if (p.length >= 16) return { label: '强', level: 'strong', width: 100 };
  return { label: '良好', level: 'medium', width: 80 };
}

export default function Setup() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const setup = useAuthStore((s) => s.setup);

  const strength = evalStrength(password);

  const onSetup = async () => {
    if (password.length < 8) {
      Taro.showToast({ title: '密码至少 8 位', icon: 'none' });
      return;
    }
    if (password !== confirm) {
      Taro.showToast({ title: '两次密码不一致', icon: 'none' });
      return;
    }
    setSubmitting(true);
    try {
      // store.setup 内部完成：派生 masterKey、wrap、上传 wrappedMasterKey
      const recoveryCode = await setup(password);
      Taro.showModal({
        title: '保存恢复码',
        content: `您的恢复码：${recoveryCode}\n\n请抄写在纸上，忘记密码时唯一找回方式。`,
        showCancel: false,
        success: () => Taro.reLaunch({ url: '/pages/index/index' }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '设置失败';
      Taro.showToast({ title: msg, icon: 'none' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="setup-container">
      <Text className="hero-title">创建主密码</Text>
      <Text className="hero-subtitle mb-l">主密码是您访问笔记的唯一凭据</Text>

      <Input
        className="mint-input"
        password
        placeholder="主密码（至少 8 位）"
        value={password}
        onInput={(e) => setPassword((e.detail as { value: string }).value)}
      />
      <Input
        className="mint-input"
        password
        placeholder="再次输入主密码"
        value={confirm}
        onInput={(e) => setConfirm((e.detail as { value: string }).value)}
      />

      {password && (
        <View className="mb-m">
          <View className="strength-bar">
            <View
              className={`strength-bar-fill ${strength.level}`}
              style={{ width: `${strength.width}%` }}
            />
          </View>
          <Text className="hint">强度：{strength.label}</Text>
        </View>
      )}

      <View
        className="mint-btn mint-btn-block"
        onClick={onSetup}
        style={{ opacity: submitting ? 0.5 : 1 }}
      >
        {submitting ? '设置中…' : '创建'}
      </View>
    </View>
  );
}
