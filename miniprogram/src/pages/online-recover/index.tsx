/**
 * 联机模式：恢复码找回密码页（对齐安卓端 OnlineRecoverScreen）
 *
 * 流程：恢复码 + 新主密码 → auth store recoverOnline（服务端三步：
 * recovery-params → recover → rewrap），成功即解锁态，回首页。
 * 忘记密码的唯一自救通道；解封的是原 masterKey，历史笔记不受影响。
 */
import React, { useState } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { ThemeVars, useThemeDarkClass } from '../../components/ThemeVars';
import { FInput } from '../../components/FInput';
import { useAuthStore } from '../../state/auth';
import { t, useLanguage } from '../../lib/i18n';

/** 恢复码格式（与 standalone-recover 一致：XXXXX-XXXXX） */
function isValidRecoveryCode(code: string): boolean {
  return /^[0-9A-Za-z]{5}-[0-9A-Za-z]{5}$/.test(code.trim());
}

export default function OnlineRecover() {
  const lang = useLanguage();
  const recoverOnline = useAuthStore((s) => s.recoverOnline);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!isValidRecoveryCode(recoveryCode)) {
      Taro.showToast({ title: t('recover.err_code'), icon: 'none' });
      return;
    }
    if (newPassword.length < 6) {
      Taro.showToast({ title: t('recover.err_pwd_len'), icon: 'none' });
      return;
    }
    if (newPassword !== confirm) {
      Taro.showToast({ title: t('recover.err_mismatch'), icon: 'none' });
      return;
    }
    setSubmitting(true);
    try {
      await recoverOnline(recoveryCode.trim(), newPassword);
      // recoverOnline 已置 authState=unlocked，回首页即是已解锁列表
      Taro.showToast({ title: t('recover.success_title'), icon: 'success' });
      Taro.reLaunch({ url: '/pages/index/index' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('recover.failed');
      Taro.showToast({ title: msg || t('recover.failed'), icon: 'none', duration: 3000 });
    } finally {
      setSubmitting(false);
    }
  };

  const darkClass = useThemeDarkClass();
  return (
    <>
      <ThemeVars />
      <View className={`setup-container ${darkClass}`}>
        <Text className="hero-logo" style={{ textAlign: 'center' }}>
          🔄
        </Text>
        <Text className="hero-title text-center">{t('recover.online_title')}</Text>
        <Text className="hero-subtitle mb-l text-center">{t('recover.online_subtitle')}</Text>

        <FInput
          className="mint-input"
          placeholder={t('recover.code_placeholder')}
          value={recoveryCode}
          maxlength={16}
          onInput={(e) => setRecoveryCode((e.detail as { value: string }).value)}
        />
        <FInput
          className="mint-input"
          password
          placeholder={t('recover.pwd_placeholder')}
          value={newPassword}
          onInput={(e) => setNewPassword((e.detail as { value: string }).value)}
        />
        <FInput
          className="mint-input"
          password
          placeholder={t('recover.confirm_placeholder')}
          value={confirm}
          onInput={(e) => setConfirm((e.detail as { value: string }).value)}
        />

        <View
          className="mint-btn mint-btn-block mt-s"
          style={{ opacity: submitting ? 0.5 : 1 }}
          onClick={() => void onSubmit()}
        >
          {submitting ? t('recover.recovering') : t('recover.online_btn')}
        </View>

        {/* 语言切换跟随全局；留返回入口 */}
        <View className="hint-mint mt-l" onClick={() => Taro.navigateBack().catch(() => {})}>
          {t('common.cancel')}
        </View>
      </View>
    </>
  );
}
