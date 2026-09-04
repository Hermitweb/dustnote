/**
 * 单机模式解锁页面（v2.0.0）
 *
 * 流程：
 * 1. 检查客户端锁定状态（连续失败 6 次锁定 15 分钟）
 * 2. 用户输入主密码
 * 3. 调用 auth store 的 unlockStandalone action（内部调用 shared.unlockLocalAuth）
 * 4. store action 负责：校验密码 + 解封 masterKey + 缓存 + 更新 authState='unlocked'
 * 5. 成功：跳转首页（authState 已更新，不会触发重定向循环）
 * 6. 失败：store action 抛错，页面记录失败次数并提示
 *
 * 关键设计：
 * - 必须通过 auth store action 更新状态，否则首页会因 authState 未更新而重定向回此页
 * - 锁定状态持久化到 Taro.setStorage（防重启绕过）
 * - 密码校验使用 Argon2id + constantTimeEqual，防时序攻击
 */

import React, { useState, useEffect } from 'react';
import { View, Text, Input, Image } from '@tarojs/components';
import logoUrl from '../../assets/logo.png';
import Taro from '@tarojs/taro';
import { ThemeVars } from '../../components/ThemeVars';
import {
  isLocked,
  remainingLockoutMs,
  INITIAL_LOCKOUT_STATE,
  type LocalLockoutState,
} from '@dustnote/shared';
import { loadLockoutStateSync } from '../../lib/local-auth-storage';
import { useAuthStore } from '../../state/auth';
import { t, useLanguage } from '../../lib/i18n';

export default function StandaloneUnlock() {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lockout, setLockout] = useState<LocalLockoutState>(INITIAL_LOCKOUT_STATE);
  const [now, setNow] = useState(Date.now());
  const unlockStandalone = useAuthStore((s) => s.unlockStandalone);
  const lang = useLanguage();

  // 语言切换后同步原生导航栏标题
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('app.name') });
  }, [lang]);

  // 启动时加载锁定状态
  useEffect(() => {
    setLockout(loadLockoutStateSync());
  }, []);

  // 锁定中时定时刷新剩余时间
  useEffect(() => {
    if (!isLocked(lockout, now)) return;
    const timer = setInterval(() => {
      const next = Date.now();
      setNow(next);
      if (!isLocked(lockout, next)) {
        // 锁定已解除，重新加载状态
        setLockout(loadLockoutStateSync());
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [lockout, now]);

  const locked = isLocked(lockout, now);
  const remainingMs = remainingLockoutMs(lockout, now);
  const remainingMin = Math.ceil(remainingMs / 60000);

  const onUnlock = async () => {
    if (locked) {
      Taro.showToast({ title: t('standalone_unlock.locked_toast', { min: remainingMin }), icon: 'none' });
      return;
    }
    if (!password) {
      Taro.showToast({ title: t('common.pwd_empty'), icon: 'none' });
      return;
    }
    setSubmitting(true);
    try {
      // 通过 auth store action：校验密码 + 解封 masterKey + 缓存 + 更新 authState='unlocked'
      // 失败时 action 会更新 lockoutState 并抛错
      await unlockStandalone(password);
      // 成功：authState 已更新为 unlocked，跳转首页不会触发重定向循环
      Taro.reLaunch({ url: '/pages/index/index' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('common.unlock_failed');
      // action 内部已更新 store 的 lockoutState，这里同步刷新本地展示
      setLockout(loadLockoutStateSync());
      Taro.showToast({ title: msg, icon: 'none' });
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
      <Text className="hero-subtitle mb-l">{t('standalone_unlock.subtitle')}</Text>

      {locked && (
        <View
          className="mint-card"
          style={{ width: '100%', maxWidth: '560rpx', background: 'var(--danger-soft)' }}
        >
          <Text className="text-danger fw-bold" style={{ display: 'block' }}>
            {t('standalone_unlock.locked_title')}
          </Text>
          <Text className="text-sm mt-s" style={{ display: 'block' }}>
            {t('standalone_unlock.locked_hint', { min: remainingMin })}
          </Text>
        </View>
      )}

      <Input
        className="mint-input"
        password
        placeholder={t('common.master_password')}
        value={password}
        disabled={locked}
        onInput={(e) => setPassword((e.detail as { value: string }).value)}
      />

      <View
        className="mint-btn mint-btn-block"
        onClick={onUnlock}
        style={{ opacity: submitting || locked ? 0.5 : 1 }}
      >
        {submitting
          ? t('common.unlocking')
          : locked
            ? t('standalone_unlock.locked_btn', { min: remainingMin })
            : t('common.unlock')}
      </View>

      <View
        className="hint-mint mt-l"
        onClick={() => Taro.navigateTo({ url: '/pages/standalone-recover/index' })}
      >
        {t('standalone_unlock.forgot')}
      </View>
    </View>
    </>
  );
}
