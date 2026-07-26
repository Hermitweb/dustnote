/**
 * 单机模式首次设置主密码页面（v2.0.0）
 *
 * 流程：
 * 1. 用户输入主密码（≥ 8 字符）+ 确认密码
 * 2. 调用 shared 的 setupLocalAuth 生成 LocalAuthBlob + masterKey + recoveryCode
 * 3. 将 blob 持久化到 Taro.setStorage（通过 local-auth-storage）
 * 4. 弹窗显示恢复码（用户必须抄写保存）
 * 5. 跳转到首页（masterKey 仅存内存，需通过全局状态或事件传递）
 *
 * 关键设计：
 * - masterKey 随机生成（不从密码派生），recover 后可保留 → 已有笔记不解密失效
 * - 恢复码仅在此页面显示一次，后续无法再次获取
 * - masterKey 通过 Taro 的事件系统或全局状态传递给首页（避免页面跳转丢失）
 */

import React, { useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { setupLocalAuth, INITIAL_LOCKOUT_STATE } from '@dustnote/shared';
import { saveLocalAuthBlobSync, saveLockoutStateSync } from '../../lib/local-auth-storage';
import { publishMasterKey } from '../../lib/standalone-session';

type Strength = { label: string; level: 'weak' | 'medium' | 'strong'; width: number };

function evalStrength(p: string): Strength {
  if (p.length < 8) return { label: '弱', level: 'weak', width: 25 };
  if (p.length < 12) return { label: '中等', level: 'medium', width: 60 };
  if (p.length >= 16) return { label: '强', level: 'strong', width: 100 };
  return { label: '良好', level: 'medium', width: 80 };
}

export default function StandaloneSetup() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const strength = evalStrength(password);

  const onSetup = async () => {
    if (password.length < 8) {
      Taro.showToast({ title: '密码至少 8 位', icon: 'none' });
      return;
    }
    if (password !== confirm) {
      Taro.showToast({ title: '两次密码不一致', icon: 'none' });
      return;
    }
    setSubmitting(true);
    try {
      Taro.showLoading({ title: '设置中…' });
      // 调用 shared 的 setupLocalAuth：生成 masterKey + blob + recoveryCode
      const { blob, masterKey, recoveryCode } = await setupLocalAuth(password);
      // 持久化 blob 到本地存储（同步写入，避免页面跳转时丢失）
      saveLocalAuthBlobSync(blob);
      // 重置锁定状态
      saveLockoutStateSync({ ...INITIAL_LOCKOUT_STATE });
      // 通过 session 模块缓存 masterKey（直接设置 + 发布事件，确保跨页面可用）
      publishMasterKey(masterKey);
      // 立即清空本地 masterKey 引用（session 模块已持有副本）
      masterKey.fill(0);
      Taro.hideLoading();

      // 弹窗显示恢复码（用户必须保存）
      Taro.showModal({
        title: '保存恢复码',
        content: `您的恢复码：${recoveryCode}\n\n请抄写在纸上，这是忘记主密码时唯一的找回方式。`,
        showCancel: false,
        confirmText: '我已保存',
        success: () => Taro.reLaunch({ url: '/pages/index/index' }),
      });
    } catch (err) {
      Taro.hideLoading();
      const msg = err instanceof Error ? err.message : '设置失败';
      Taro.showToast({ title: msg, icon: 'none' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="setup-container">
      <Text className="hero-logo" style={{ textAlign: 'center' }}>
        🌿
      </Text>
      <Text className="hero-title text-center">设置主密码（单机模式）</Text>
      <Text className="hero-subtitle mb-l text-center">
        主密码本地验证 · 数据存储在本机 · 无需服务器
      </Text>

      <Input
        className="mint-input"
        password
        placeholder="主密码（至少 8 位）"
        value={password}
        onInput={(e) => setPassword((e.detail as { value: string }).value)}
      />
      <Input
        className="mint-input"
        password
        placeholder="再次输入主密码"
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
          <Text className="hint">强度：{strength.label}</Text>
        </View>
      )}

      <View
        className="mint-btn mint-btn-block"
        onClick={onSetup}
        style={{ opacity: submitting ? 0.5 : 1 }}
      >
        {submitting ? '设置中…' : '创建主密码'}
      </View>

      <Text className="hint mt-l" style={{ display: 'block', textAlign: 'center' }}>
        ⚠️ 主密码无法找回，请务必保存恢复码
      </Text>
      <Text className="text-xs text-muted mt-s" style={{ display: 'block', textAlign: 'center' }}>
        单机模式数据存储在本机，卸载小程序或清除缓存将丢失数据
      </Text>
    </View>
  );
}
