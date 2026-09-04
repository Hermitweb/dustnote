/**
 * 小程序首次设置：创建主密码 + 生成恢复码
 * 接入 E2EE：调用 store.setup 完成 masterKey 派生与包装
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { ThemeVars } from '../../components/ThemeVars';
import { useAuthStore } from '../../state/auth';
import { t, useLanguage } from '../../lib/i18n';

type Strength = { label: string; level: 'weak' | 'medium' | 'strong'; width: number };

function evalStrength(p: string): Strength {
  if (p.length < 6) return { label: t('common.strength_weak'), level: 'weak', width: 25 };
  if (p.length < 12) return { label: t('common.strength_medium'), level: 'medium', width: 60 };
  if (p.length >= 16) return { label: t('common.strength_strong'), level: 'strong', width: 100 };
  return { label: t('common.strength_good'), level: 'medium', width: 80 };
}

export default function Setup() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const setup = useAuthStore((s) => s.setup);
  const lang = useLanguage();

  // 语言切换后同步原生导航栏标题
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('app.name') });
  }, [lang]);

  const strength = evalStrength(password);

  const onSetup = async () => {
    if (password.length < 6) {
      Taro.showToast({ title: t('setup.err_pwd_len'), icon: 'none' });
      return;
    }
    if (password !== confirm) {
      Taro.showToast({ title: t('setup.err_pwd_mismatch'), icon: 'none' });
      return;
    }
    setSubmitting(true);
    try {
      // store.setup 内部完成：派生 masterKey、wrap、上传 wrappedMasterKey
      const recoveryCode = await setup(password);
      Taro.showModal({
        title: t('setup.recovery_title'),
        content: t('setup.recovery_content', { code: recoveryCode }),
        showCancel: false,
        success: () => Taro.reLaunch({ url: '/pages/index/index' }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('setup.failed');
      Taro.showToast({ title: msg, icon: 'none' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
    <ThemeVars />
    <View className="setup-container">
      <Text className="hero-title">{t('setup.title')}</Text>
      <Text className="hero-subtitle mb-l">{t('setup.subtitle')}</Text>

      <Input
        className="mint-input"
        password
        placeholder={t('setup.pwd_placeholder')}
        value={password}
        onInput={(e) => setPassword((e.detail as { value: string }).value)}
      />
      <Input
        className="mint-input"
        password
        placeholder={t('setup.confirm_placeholder')}
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
        onClick={onSetup}
        style={{ opacity: submitting ? 0.5 : 1 }}
      >
        {submitting ? t('setup.setting_up') : t('setup.create')}
      </View>
    </View>
    </>
  );
}
