/**
 * 单机模式恢复页面（v2.0.0）
 *
 * 流程：
 * 1. 用户输入恢复码（10 位 Crockford Base32）+ 新主密码（≥ 8 字符）+ 确认新密码
 * 2. 调用 auth store 的 recoverStandalone action（内部调用 shared.recoverLocalAuth）
 * 3. store action 负责：校验恢复码 + 解封原始 masterKey + 重新包装 + 持久化 + 更新 authState
 * 4. 成功：显示新恢复码，跳转首页（authState 已更新，不会触发重定向循环）
 * 5. 失败：提示恢复码错误
 *
 * 关键设计（与 setup 的差异）：
 * - masterKey 不变（保留 setup 时随机生成的原始 masterKey）
 * - 已有笔记可继续解密 ✅
 * - 旧恢复码失效，生成新恢复码
 * - 旧密码失效，使用新密码重新派生 passwordDerivedKey
 * - 必须通过 auth store action 更新状态，否则首页会因 authState 未更新而重定向回此页
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { isValidRecoveryCode } from '@dustnote/shared';
import { useAuthStore } from '../../state/auth';
import { t, useLanguage } from '../../lib/i18n';

type Strength = { label: string; level: 'weak' | 'medium' | 'strong'; width: number };

function evalStrength(p: string): Strength {
  if (p.length < 6) return { label: t('common.strength_weak'), level: 'weak', width: 25 };
  if (p.length < 12) return { label: t('common.strength_medium'), level: 'medium', width: 60 };
  if (p.length >= 16) return { label: t('common.strength_strong'), level: 'strong', width: 100 };
  return { label: t('common.strength_good'), level: 'medium', width: 80 };
}

export default function StandaloneRecover() {
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const recoverStandalone = useAuthStore((s) => s.recoverStandalone);
  const lang = useLanguage();

  // 语言切换后同步原生导航栏标题
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('app.name') });
  }, [lang]);

  const strength = evalStrength(newPassword);

  const onRecover = async () => {
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
      Taro.showLoading({ title: t('recover.recovering') });
      // 通过 auth store action：校验恢复码 + 解封 masterKey + 重新包装 + 持久化 + 更新 authState
      const newRecoveryCode = await recoverStandalone(recoveryCode, newPassword);
      Taro.hideLoading();
      // 弹窗显示新恢复码
      Taro.showModal({
        title: t('recover.success_title'),
        content: t('recover.success_content', { code: newRecoveryCode }),
        showCancel: false,
        confirmText: t('recover.saved_btn'),
        success: () => Taro.reLaunch({ url: '/pages/index/index' }),
      });
    } catch (err) {
      Taro.hideLoading();
      const msg = err instanceof Error ? err.message : t('recover.failed');
      Taro.showToast({ title: msg, icon: 'none' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="setup-container">
      <Text className="hero-logo" style={{ textAlign: 'center' }}>
        🔑
      </Text>
      <Text className="hero-title text-center">{t('recover.title')}</Text>
      <Text className="hero-subtitle mb-l text-center">{t('recover.subtitle')}</Text>

      <Input
        className="mint-input"
        placeholder={t('recover.code_placeholder')}
        value={recoveryCode}
        maxlength={16}
        onInput={(e) => setRecoveryCode((e.detail as { value: string }).value)}
      />
      <Input
        className="mint-input"
        password
        placeholder={t('recover.pwd_placeholder')}
        value={newPassword}
        onInput={(e) => setNewPassword((e.detail as { value: string }).value)}
      />
      <Input
        className="mint-input"
        password
        placeholder={t('recover.confirm_placeholder')}
        value={confirm}
        onInput={(e) => setConfirm((e.detail as { value: string }).value)}
      />

      {newPassword && (
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
        onClick={onRecover}
        style={{ opacity: submitting ? 0.5 : 1 }}
      >
        {submitting ? t('recover.recovering') : t('recover.reset_btn')}
      </View>

      <Text className="hint mt-l" style={{ display: 'block', textAlign: 'center' }}>
        {t('recover.note_ok')}
      </Text>
      <Text className="text-xs text-muted mt-s" style={{ display: 'block', textAlign: 'center' }}>
        {t('recover.note_warn')}
      </Text>

      <View className="hint-mint mt-l" onClick={() => Taro.navigateBack({ delta: 1 })}>
        {t('recover.back')}
      </View>
    </View>
  );
}
