/**
 * 小程序解锁页：输入主密码解锁
 * 接入 E2EE：调用 store.unlock 完成密码校验 + masterKey 重新派生
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Image } from '@tarojs/components';
import { FInput } from '../../components/FInput';
import logoUrl from '../../assets/logo.png';
import Taro from '@tarojs/taro';
import { ThemeVars, useThemeDarkClass } from '../../components/ThemeVars';
import { useAuthStore } from '../../state/auth';
import { t, useLanguage } from '../../lib/i18n';
import {
  isBiometricEnabled,
  isBiometricSupported,
  promptBiometric,
} from '../../lib/biometric';

export default function Unlock() {
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showTotp, setShowTotp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [bioReady, setBioReady] = useState(false);
  const unlock = useAuthStore((s) => s.unlock);
  const unlockWithBiometric = useAuthStore((s) => s.unlockWithBiometric);
  const lang = useLanguage();

  // 语言切换后同步原生导航栏标题
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('app.name') });
  }, [lang]);

  // 指纹解锁入口：设备支持且用户已启用（缓存存在校验在验证通过后进行）
  useEffect(() => {
    void (async () => {
      setBioReady((await isBiometricSupported()) && isBiometricEnabled());
    })();
  }, []);

  const onBiometric = async () => {
    const ok = await promptBiometric();
    if (!ok) return;
    const restored = await unlockWithBiometric();
    if (restored) {
      Taro.reLaunch({ url: '/pages/index/index' });
    } else {
      // 缓存缺失（改密后未续写/账号数据变更）：回退密码解锁
      Taro.showToast({ title: t('unlock.bio_fallback'), icon: 'none' });
    }
  };

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

  const darkClass = useThemeDarkClass();
  return (
    <>
    <ThemeVars />
      <View className={`hero ${darkClass}`}>
      <Image src={logoUrl} className="hero-logo" style={{ width: '64px', height: '64px' }} />
      <Text className="hero-title text-mint">{t('app.name')}</Text>
      <Text className="hero-subtitle mb-l">{t('unlock.subtitle')}</Text>

      <FInput
        className="mint-input"
        password
        placeholder={t('common.master_password')}
        value={password}
        onInput={(e) => setPassword((e.detail as { value: string }).value)}
      />

      {showTotp && (
        <FInput
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

      {bioReady && !submitting && (
        <View className="mint-btn mint-btn-ghost mint-btn-block mt-s" onClick={() => void onBiometric()}>
          🔒 {t('unlock.biometric_btn')}
        </View>
      )}

      <View
        className="hint-mint mt-l"
        onClick={() => Taro.navigateTo({ url: '/pages/setup/index' })}
      >
        {t('unlock.create_hint')}
      </View>

      {/* 忘记密码：恢复码找回（对齐安卓端入口） */}
      <View
        className="hint-mint"
        onClick={() => Taro.navigateTo({ url: '/pages/online-recover/index' })}
      >
        {t('recover.forgot')}
      </View>
    </View>
    </>
  );
}
