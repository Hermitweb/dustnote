/**
 * 小程序解锁页：输入主密码解锁
 * 接入 E2EE：调用 store.unlock 完成密码校验 + masterKey 重新派生
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Input, Image } from '@tarojs/components';
import logoUrl from '../../assets/logo.png';
import Taro from '@tarojs/taro';
import { ThemeVars } from '../../components/ThemeVars';
import { useAuthStore } from '../../state/auth';
import { t, useLanguage } from '../../lib/i18n';

export default function Unlock() {
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showTotp, setShowTotp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const unlock = useAuthStore((s) => s.unlock);
  const lang = useLanguage();

  // 语言切换后同步原生导航栏标题
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('app.name') });
  }, [lang]);

  const onUnlock = async () => {
    if (!password) {
      Taro.showToast({ title: t('common.pwd_empty'), icon: 'none' });
      return;
    }
    setSubmitting(true);
    try {
      await unlock(password, showTotp ? totpCode : undefined);
      Taro.reLaunch({ url: '/pages/index/index' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('common.unlock_failed');
      if (msg.includes('totp_required') || msg.includes('两步验证码')) {
        setShowTotp(true);
        Taro.showToast({ title: t('unlock.err_totp'), icon: 'none' });
      } else {
        Taro.showToast({ title: msg, icon: 'none' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
    <ThemeVars />
      <View className="hero">
      <Image src={logoUrl} className="hero-logo" style={{ width: '64px', height: '64px' }} />
      <Text className="hero-title text-mint">DustNote</Text>
      <Text className="hero-subtitle mb-l">{t('unlock.subtitle')}</Text>

      <Input
        className="mint-input"
        password
        placeholder={t('common.master_password')}
        value={password}
        onInput={(e) => setPassword((e.detail as { value: string }).value)}
      />

      {showTotp && (
        <Input
          className="mint-input"
          placeholder={t('unlock.totp_placeholder')}
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
        {submitting ? t('common.unlocking') : t('common.unlock')}
      </View>

      <View
        className="hint-mint mt-l"
        onClick={() => Taro.navigateTo({ url: '/pages/setup/index' })}
      >
        {t('unlock.create_hint')}
      </View>
    </View>
    </>
  );
}
