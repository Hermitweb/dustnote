/**
 * 单机模式首次设置主密码页面（v2.0.0）
 *
 * 流程：
 * 1. 用户输入主密码（≥ 8 字符）+ 确认密码
 * 2. 调用 auth store 的 setupStandalone action（内部调用 shared.setupLocalAuth）
 * 3. store action 负责：持久化 blob + 缓存 masterKey + 更新 authState='unlocked'
 * 4. 弹窗显示恢复码（用户必须抄写保存）
 * 5. 跳转到首页（authState 已更新为 unlocked，不会触发重定向循环）
 *
 * 关键设计：
 * - masterKey 随机生成（不从密码派生），recover 后可保留 → 已有笔记不解密失效
 * - 恢复码仅在此页面显示一次，后续无法再次获取
 * - 必须通过 auth store action 更新状态，否则首页会因 authState 未更新而重定向回此页
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Input, Image } from '@tarojs/components';
import logoUrl from '../../assets/logo.png';
import Taro from '@tarojs/taro';
import { ThemeVars, useThemeDarkClass } from '../../components/ThemeVars';
import { useAuthStore } from '../../state/auth';
import { t, useLanguage } from '../../lib/i18n';

type Strength = { label: string; level: 'weak' | 'medium' | 'strong'; width: number };

function evalStrength(p: string): Strength {
  if (p.length < 6) return { label: t('common.strength_weak'), level: 'weak', width: 25 };
  if (p.length < 12) return { label: t('common.strength_medium'), level: 'medium', width: 60 };
  if (p.length >= 16) return { label: t('common.strength_strong'), level: 'strong', width: 100 };
  return { label: t('common.strength_good'), level: 'medium', width: 80 };
}

export default function StandaloneSetup() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const setupStandalone = useAuthStore((s) => s.setupStandalone);
  const lang = useLanguage();

  // 语言切换后同步原生导航栏标题
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('app.name') });
  }, [lang]);

  const strength = evalStrength(password);

  // 主流程：校验 → setupStandalone → 展示恢复码弹窗
  const doSetup = async (pwd: string, confirmPwd: string) => {
    if (pwd.length < 6) {
      Taro.showToast({ title: t('standalone_setup.err_pwd_len'), icon: 'none' });
      return;
    }
    if (pwd !== confirmPwd) {
      Taro.showToast({ title: t('standalone_setup.err_mismatch'), icon: 'none' });
      return;
    }
    setSubmitting(true);
    try {
      Taro.showLoading({ title: t('standalone_setup.setting_up') });
      // 通过 auth store action：生成 masterKey + blob + recoveryCode，
      // 持久化 blob、缓存 masterKey、更新 authState='unlocked'
      const recoveryCode = await setupStandalone(pwd);
      Taro.hideLoading();

      // 弹窗显示恢复码（用户必须保存）
      Taro.showModal({
        title: t('standalone_setup.recovery_title'),
        content: t('standalone_setup.recovery_content', { code: recoveryCode }),
        showCancel: false,
        confirmText: t('standalone_setup.saved_btn'),
        success: () => Taro.reLaunch({ url: '/pages/index/index' }),
      });
    } catch (err) {
      Taro.hideLoading();
      const msg = err instanceof Error ? err.message : t('standalone_setup.failed');
      Taro.showToast({ title: msg, icon: 'none' });
    } finally {
      setSubmitting(false);
    }
  };

  const darkClass = useThemeDarkClass();
  return (
    <>
    <ThemeVars />
    <View className={`setup-container ${darkClass}`}>
      <Image
        src={logoUrl}
        className="hero-logo"
        style={{ width: '64px', height: '64px', textAlign: 'center' }}
      />
      <Text className="hero-title text-center">{t('standalone_setup.title')}</Text>
      <Text className="hero-subtitle mb-l text-center">{t('standalone_setup.subtitle')}</Text>

      <Input
        className="mint-input"
        password
        placeholder={t('standalone_setup.pwd_placeholder')}
        value={password}
        onInput={(e) => setPassword((e.detail as { value: string }).value)}
      />
      <Input
        className="mint-input"
        password
        placeholder={t('standalone_setup.confirm_placeholder')}
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
          <Text className="hint">{t('common.strength_label', { label: strength.label })}</Text>
        </View>
      )}

      <View
        className="mint-btn mint-btn-block"
        onClick={() => doSetup(password, confirm)}
        style={{ opacity: submitting ? 0.5 : 1 }}
      >
        {submitting ? t('standalone_setup.setting_up') : t('standalone_setup.create_btn')}
      </View>

      <Text className="hint mt-l" style={{ display: 'block', textAlign: 'center' }}>
        {t('standalone_setup.warn')}
      </Text>
      <Text className="text-xs text-muted mt-s" style={{ display: 'block', textAlign: 'center' }}>
        {t('standalone_setup.data_warn')}
      </Text>
    </View>
    </>
  );
}
