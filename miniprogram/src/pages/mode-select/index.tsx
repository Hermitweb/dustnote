/**
 * 模式选择页面（v2.0.0 单机/联机双模式）
 *
 * 首次启动时显示，让用户选择单机/联机模式：
 * - 单机模式（standalone）：无服务器，数据存储在本地 Taro.setStorage，主密码本地验证
 * - 联机模式（online）：连接服务器，解锁全部功能
 *
 * 选择后写入 mode-store 并跳转到对应页面：
 * - standalone → /pages/standalone-setup/index（首次）或 /pages/standalone-unlock/index（已有）
 * - online → /pages/setup/index（首次）或 /pages/unlock/index（已有）
 */

import React, { useState, useEffect } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useModeStore } from '../../lib/mode-store';
import { hasLocalAuthSync } from '../../lib/local-auth-storage';
import { ApiClient } from '@dustnote/shared';

const APP_VERSION = '2.1.0';

/**
 * 测试服务器连通性
 *
 * 调用 /auth/status 接口，返回 true 表示可连接。
 * 失败原因可能是：URL 错误、网络不通、服务器未启动等。
 */
async function testServerConnection(serverUrl: string): Promise<{ ok: boolean; message: string }> {
  const trimmed = serverUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return { ok: false, message: '请输入服务器地址' };
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return { ok: false, message: '地址需以 http:// 或 https:// 开头' };
  }
  try {
    const api = new ApiClient({
      baseUrl: `${trimmed}/api/v1`,
      clientVersion: APP_VERSION,
      platform: 'miniprogram',
      channel: 'stable',
      deviceId: 'connection-test',
    });
    const r = await api.get<{ initialized: boolean }>('/auth/status');
    return {
      ok: true,
      message: r.initialized ? '连接成功（服务器已初始化）' : '连接成功（服务器未初始化）',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '连接失败';
    return { ok: false, message: msg };
  }
}

export default function ModeSelect() {
  const setMode = useModeStore((s) => s.setMode);
  const setServerUrl = useModeStore((s) => s.setServerUrl);
  const initialize = useModeStore((s) => s.initialize);
  const modeInitialized = useModeStore((s) => s.initialized);
  const currentMode = useModeStore((s) => s.mode);

  const [serverUrl, setServerUrlInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // 已选过模式时自动跳转到对应流程（避免每次启动都显示模式选择页）
  useEffect(() => {
    if (!modeInitialized) return;
    if (currentMode === 'standalone') {
      Taro.reLaunch({
        url: hasLocalAuthSync() ? '/pages/standalone-unlock/index' : '/pages/standalone-setup/index',
      });
    } else {
      // 联机模式：跳转到 index 页面，由 useAuthStore.init 判断状态
      Taro.reLaunch({ url: '/pages/index/index' });
    }
  }, [modeInitialized, currentMode]);

  /** 选定单机模式：写入 mode-store，根据是否已设置主密码跳转 */
  const chooseStandalone = () => {
    setMode('standalone');
    setServerUrl(null);
    initialize();
    if (hasLocalAuthSync()) {
      Taro.reLaunch({ url: '/pages/standalone-unlock/index' });
    } else {
      Taro.reLaunch({ url: '/pages/standalone-setup/index' });
    }
  };

  /** 测试联机服务器连通性 */
  const onTestConnection = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testServerConnection(serverUrl);
      setTestResult(r);
    } finally {
      setTesting(false);
    }
  };

  /** 选定联机模式：测试连接通过后写入 mode-store，根据服务器是否已初始化跳转 */
  const chooseOnline = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testServerConnection(serverUrl);
      setTestResult(r);
      if (!r.ok) {
        Taro.showToast({ title: r.message, icon: 'none' });
        return;
      }
      const trimmed = serverUrl.trim().replace(/\/+$/, '');
      setMode('online');
      setServerUrl(trimmed);
      initialize();
      // 联机模式：跳转到 index 页面，由 useAuthStore.init 判断状态
      Taro.reLaunch({ url: '/pages/index/index' });
    } finally {
      setTesting(false);
    }
  };

  // 已初始化时不渲染选择 UI（避免跳转前闪烁）
  if (modeInitialized) {
    return (
      <View className="hero">
        <Text className="hero-subtitle">加载中…</Text>
      </View>
    );
  }

  return (
    <View className="hero">
      <Text className="hero-logo">🌿</Text>
      <Text className="hero-title">欢迎使用 DustNote</Text>
      <Text className="hero-subtitle">端到端加密 · 单机/联机双模式</Text>

      {/* 单机模式入口 */}
      <View className="mint-card mt-l" style={{ width: '100%', maxWidth: '560rpx' }} onClick={chooseStandalone}>
        <View className="row between">
          <Text className="text-lg fw-bold">📱 单机模式</Text>
          <Text className="text-mint">›</Text>
        </View>
        <Text className="hint mt-s" style={{ display: 'block' }}>
          无需服务器，数据存储在本地，主密码本地验证。
        </Text>
        <Text className="text-xs text-muted mt-s" style={{ display: 'block' }}>
          适合：私密笔记 / 离线使用 / 数据完全自持
        </Text>
      </View>

      {/* 联机模式入口 */}
      <View className="mint-card mt-m" style={{ width: '100%', maxWidth: '560rpx' }}>
        <View className="row between">
          <Text className="text-lg fw-bold">🌐 联机模式</Text>
          <Text className="text-mint">›</Text>
        </View>
        <Text className="hint mt-s" style={{ display: 'block' }}>
          连接服务器，多端同步、解锁全部功能。
        </Text>
        <Input
          className="mint-input mt-m"
          placeholder="http://192.168.x.x:3210"
          value={serverUrl}
          onInput={(e) => setServerUrlInput((e.detail as { value: string }).value)}
        />
        {testResult && (
          <Text
            className={`text-xs mt-s ${testResult.ok ? 'success-text' : 'error-text'}`}
            style={{ display: 'block' }}
          >
            {testResult.ok ? '✓ ' : '✗ '}
            {testResult.message}
          </Text>
        )}
        <View className="row gap-s mt-m">
          <View
            className="mint-btn mint-btn-outline mint-btn-sm"
            style={{ opacity: testing ? 0.5 : 1 }}
            onClick={onTestConnection}
          >
            {testing ? '测试中…' : '测试连接'}
          </View>
          <View
            className="mint-btn mint-btn-sm"
            style={{ opacity: testing ? 0.5 : 1 }}
            onClick={chooseOnline}
          >
            进入联机模式
          </View>
        </View>
      </View>

      <Text className="text-xs text-muted mt-l" style={{ display: 'block', maxWidth: '560rpx' }}>
        提示：单机模式可随时在设置中切换为联机模式（需重新设置主密码）。
      </Text>
    </View>
  );
}
