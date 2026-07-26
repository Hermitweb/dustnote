/**
 * 单机模式解锁页面（v2.0.0）
 *
 * 流程：
 * 1. 检查客户端锁定状态（连续失败 6 次锁定 15 分钟）
 * 2. 用户输入主密码
 * 3. 调用 shared 的 unlockLocalAuth 校验密码 + 解封 masterKey
 * 4. 成功：重置锁定状态，通过事件传递 masterKey 给首页，跳转
 * 5. 失败：记录失败次数，达到阈值后锁定
 *
 * 关键设计：
 * - masterKey 通过 Taro.eventCenter 传递给首页（仅在内存中）
 * - 锁定状态持久化到 Taro.setStorage（防重启绕过）
 * - 密码校验使用 Argon2id + constantTimeEqual，防时序攻击
 */

import React, { useState, useEffect } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import {
  unlockLocalAuth,
  isLocked,
  recordFailedAttempt,
  recordSuccessfulAttempt,
  remainingLockoutMs,
  INITIAL_LOCKOUT_STATE,
  type LocalLockoutState,
} from '@dustnote/shared';
import {
  loadLocalAuthBlobSync,
  loadLockoutStateSync,
  saveLockoutStateSync,
} from '../../lib/local-auth-storage';

/** 将 masterKey 通过 Taro 事件传递给首页（base64 编码） */
function publishMasterKey(masterKey: Uint8Array): void {
  let s = '';
  for (let i = 0; i < masterKey.length; i++) s += String.fromCharCode(masterKey[i]!);
  const b64 = btoa(s);
  Taro.eventCenter.trigger('standalone:masterKey', b64);
}

export default function StandaloneUnlock() {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lockout, setLockout] = useState<LocalLockoutState>(INITIAL_LOCKOUT_STATE);
  const [now, setNow] = useState(Date.now());

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
      Taro.showToast({ title: `已锁定，请 ${remainingMin} 分钟后再试`, icon: 'none' });
      return;
    }
    if (!password) {
      Taro.showToast({ title: '请输入主密码', icon: 'none' });
      return;
    }
    setSubmitting(true);
    try {
      const blob = loadLocalAuthBlobSync();
      if (!blob) {
        // 未设置主密码，跳转到 setup
        Taro.reLaunch({ url: '/pages/standalone-setup/index' });
        return;
      }
      const result = await unlockLocalAuth(password, blob);
      if (result.success && result.masterKey) {
        // 成功：重置锁定状态，传递 masterKey，跳转首页
        const reset = recordSuccessfulAttempt();
        saveLockoutStateSync(reset);
        publishMasterKey(result.masterKey);
        // 立即清空 masterKey 内存引用
        result.masterKey.fill(0);
        Taro.reLaunch({ url: '/pages/index/index' });
      } else {
        // 失败：记录失败次数，可能触发锁定
        const next = recordFailedAttempt(lockout);
        saveLockoutStateSync(next);
        setLockout(next);
        if (isLocked(next)) {
          Taro.showToast({ title: '失败次数过多，已锁定 15 分钟', icon: 'none' });
        } else {
          const left = 6 - next.failedAttempts;
          Taro.showToast({
            title: `主密码错误，还可尝试 ${left} 次`,
            icon: 'none',
          });
        }
      }
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
      <Text className="hero-subtitle mb-l">单机模式 · 输入主密码解锁</Text>

      {locked && (
        <View
          className="mint-card"
          style={{ width: '100%', maxWidth: '560rpx', background: 'var(--danger-soft)' }}
        >
          <Text className="text-danger fw-bold" style={{ display: 'block' }}>
            🔒 已锁定
          </Text>
          <Text className="text-sm mt-s" style={{ display: 'block' }}>
            连续失败 6 次，请 {remainingMin} 分钟后再试
          </Text>
        </View>
      )}

      <Input
        className="mint-input"
        password
        placeholder="主密码"
        value={password}
        disabled={locked}
        onInput={(e) => setPassword((e.detail as { value: string }).value)}
      />

      <View
        className="mint-btn mint-btn-block"
        onClick={onUnlock}
        style={{ opacity: submitting || locked ? 0.5 : 1 }}
      >
        {submitting ? '解锁中…' : locked ? `已锁定（${remainingMin} 分钟）` : '解锁'}
      </View>

      <View
        className="hint-mint mt-l"
        onClick={() => Taro.navigateTo({ url: '/pages/standalone-recover/index' })}
      >
        忘记主密码？使用恢复码
      </View>
    </View>
  );
}
