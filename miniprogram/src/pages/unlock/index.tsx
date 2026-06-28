/**
 * 小程序解锁页：输入主密码解锁
 * 接入 E2EE：调用 store.unlock 完成密码校验 + masterKey 重新派生
 */
import React, { useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAuthStore } from '../../state/auth';

export default function Unlock() {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const unlock = useAuthStore((s) => s.unlock);

  const onUnlock = async () => {
    if (!password) {
      Taro.showToast({ title: '请输入主密码', icon: 'none' });
      return;
    }
    setSubmitting(true);
    try {
      // store.unlock 内部完成：密码校验 + 用 clientMasterSalt 重新派生 masterKey
      await unlock(password);
      Taro.reLaunch({ url: '/pages/index/index' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '解锁失败';
      Taro.showToast({ title: msg, icon: 'none' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="hero">
      <Text className="hero-logo">🌿</Text>
      <Text className="hero-title text-mint">DustNote</Text>
      <Text className="hero-subtitle mb-l">输入主密码解锁</Text>

      <Input
        className="mint-input"
        password
        placeholder="主密码"
        value={password}
        onInput={(e) => setPassword((e.detail as { value: string }).value)}
      />

      <View
        className="mint-btn mint-btn-block"
        onClick={onUnlock}
        style={{ opacity: submitting ? 0.5 : 1 }}
      >
        {submitting ? '解锁中…' : '解锁'}
      </View>

      <View
        className="hint-mint mt-l"
        onClick={() => Taro.navigateTo({ url: '/pages/setup/index' })}
      >
        还没有账号？创建主密码
      </View>
    </View>
  );
}
