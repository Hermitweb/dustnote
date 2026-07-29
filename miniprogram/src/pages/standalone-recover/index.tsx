/**
 * 单机模式恢复页面（v2.0.0）
 *
 * 流程：
 * 1. 用户输入恢复码（10 位 Crockford Base32）+ 新主密码（≥ 8 字符）+ 确认新密码
 * 2. 调用 shared 的 recoverLocalAuth 校验恢复码 + 解封原始 masterKey + 重新包装
 * 3. 成功：持久化新 blob，通过事件传递原始 masterKey 给首页，显示新恢复码
 * 4. 失败：提示恢复码错误
 *
 * 关键设计（与 setup 的差异）：
 * - masterKey 不变（保留 setup 时随机生成的原始 masterKey）
 * - 已有笔记可继续解密 ✅
 * - 旧恢复码失效，生成新恢复码
 * - 旧密码失效，使用新密码重新派生 passwordDerivedKey
 */

import React, { useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { recoverLocalAuth, isValidRecoveryCode } from '@dustnote/shared';
import {
  loadLocalAuthBlobSync,
  saveLocalAuthBlobSync,
  saveLockoutStateSync,
} from '../../lib/local-auth-storage';
import { INITIAL_LOCKOUT_STATE } from '@dustnote/shared';

type Strength = { label: string; level: 'weak' | 'medium' | 'strong'; width: number };

function evalStrength(p: string): Strength {
  if (p.length < 8) return { label: '弱', level: 'weak', width: 25 };
  if (p.length < 12) return { label: '中等', level: 'medium', width: 60 };
  if (p.length >= 16) return { label: '强', level: 'strong', width: 100 };
  return { label: '良好', level: 'medium', width: 80 };
}

/** 将 masterKey 通过 Taro 事件传递给首页（base64 编码） */
function publishMasterKey(masterKey: Uint8Array): void {
  let s = '';
  for (let i = 0; i < masterKey.length; i++) s += String.fromCharCode(masterKey[i]!);
  const b64 = btoa(s);
  Taro.eventCenter.trigger('standalone:masterKey', b64);
}

export default function StandaloneRecover() {
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const strength = evalStrength(newPassword);

  const onRecover = async () => {
    if (!isValidRecoveryCode(recoveryCode)) {
      Taro.showToast({ title: '恢复码格式不正确（XXXXX-XXXXX）', icon: 'none' });
      return;
    }
    if (newPassword.length < 8) {
      Taro.showToast({ title: '新密码至少 8 位', icon: 'none' });
      return;
    }
    if (newPassword !== confirm) {
      Taro.showToast({ title: '两次密码不一致', icon: 'none' });
      return;
    }
    const oldBlob = loadLocalAuthBlobSync();
    if (!oldBlob) {
      Taro.showToast({ title: '未找到本地鉴权数据', icon: 'none' });
      return;
    }
    setSubmitting(true);
    try {
      Taro.showLoading({ title: '恢复中…' });
      const result = await recoverLocalAuth(recoveryCode, newPassword, oldBlob);
      Taro.hideLoading();
      if (result.success && result.blob && result.masterKey && result.recoveryCode) {
        // 持久化新 blob
        saveLocalAuthBlobSync(result.blob);
        // 重置锁定状态
        saveLockoutStateSync({ ...INITIAL_LOCKOUT_STATE });
        // 通过事件传递原始 masterKey 给首页
        publishMasterKey(result.masterKey);
        // 立即清空 masterKey 内存引用
        result.masterKey.fill(0);
        // 弹窗显示新恢复码
        Taro.showModal({
          title: '恢复成功',
          content: `已设置新主密码\n\n新恢复码：${result.recoveryCode}\n\n请抄写保存，旧恢复码已失效。`,
          showCancel: false,
          confirmText: '我已保存',
          success: () => Taro.reLaunch({ url: '/pages/index/index' }),
        });
      } else {
        Taro.showToast({ title: '恢复码错误', icon: 'none' });
      }
    } catch (err) {
      Taro.hideLoading();
      const msg = err instanceof Error ? err.message : '恢复失败';
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
      <Text className="hero-title text-center">使用恢复码重置主密码</Text>
      <Text className="hero-subtitle mb-l text-center">
        输入恢复码 + 新主密码 · 原有笔记不受影响
      </Text>

      <Input
        className="mint-input"
        placeholder="恢复码 (XXXXX-XXXXX)"
        value={recoveryCode}
        maxlength={16}
        onInput={(e) => setRecoveryCode((e.detail as { value: string }).value)}
      />
      <Input
        className="mint-input"
        password
        placeholder="新主密码（至少 8 位）"
        value={newPassword}
        onInput={(e) => setNewPassword((e.detail as { value: string }).value)}
      />
      <Input
        className="mint-input"
        password
        placeholder="再次输入新主密码"
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
          <Text className="hint">强度：{strength.label}</Text>
        </View>
      )}

      <View
        className="mint-btn mint-btn-block"
        onClick={onRecover}
        style={{ opacity: submitting ? 0.5 : 1 }}
      >
        {submitting ? '恢复中…' : '重置主密码'}
      </View>

      <Text className="hint mt-l" style={{ display: 'block', textAlign: 'center' }}>
        ✓ 恢复后原有笔记可继续解密（masterKey 保持不变）
      </Text>
      <Text className="text-xs text-muted mt-s" style={{ display: 'block', textAlign: 'center' }}>
        恢复成功后，旧恢复码和旧主密码都将失效
      </Text>

      <View
        className="hint-mint mt-l"
        onClick={() => Taro.navigateBack({ delta: 1 })}
      >
        ← 返回解锁
      </View>
    </View>
  );
}
