/**
 * 小程序解锁页：输入主密码解锁
 * 接入 E2EE：调用 store.unlock 完成密码校验 + masterKey 重新派生
 */
import React, { useState } from 'react';
import { View, Text, Input, Image } from '@tarojs/components';
import logoUrl from '../../assets/logo.png';
import Taro from '@tarojs/taro';
import { useAuthStore } from '../../state/auth';

export default function Unlock() {
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showTotp, setShowTotp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const unlock = useAuthStore((s) => s.unlock);

  const onUnlock = async () => {
    if (!password) {
      Taro.showToast({ title: '请输入主密码', icon: 'none' });
      return;
    }
    setSubmitting(true);
    try {
      await unlock(password, showTotp ? totpCode : undefined);
      Taro.reLaunch({ url: '/pages/index/index' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '解锁失败';
      if (msg.includes('totp_required') || msg.includes('两步验证码')) {
        setShowTotp(true);
        Taro.showToast({ title: '请输入两步验证码', icon: 'none' });
      } else {
        Taro.showToast({ title: msg, icon: 'none' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="hero">
      <Image src={logoUrl} className="hero-logo" style={{ width: '64px', height: '64px' }} />
      <Text className="hero-title text-mint">DustNote</Text>
      <Text className="hero-subtitle mb-l">输入主密码解锁</Text>

      <Input
        className="mint-input"
        password
        placeholder="主密码"
        value={password}
        onInput={(e) => setPassword((e.detail as { value: string }).value)}
      />

      {showTotp && (
        <Input
          className="mint-input"
          placeholder="两步验证码（6位数字）"
          type="number"
          maxlength={6}
          value={totpCode}
          onInput={(e) => setTotpCode((e.detail as { value: string }).value)}
        />
      )}

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
