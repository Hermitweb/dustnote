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
import { View, Text, Image } from '@tarojs/components';
import { FInput } from '../../components/FInput';
import logoUrl from '../../assets/logo.png';
import Taro from '@tarojs/taro';
import { Icon } from '../../components/Icon';
import { ThemeVars, useThemeDarkClass } from '../../components/ThemeVars';
import { useModeStore } from '../../lib/mode-store';
import {
  DEPLOY_DEFAULT_SERVER_URL,
  isDeployDefaultApplied,
  markDeployDefaultApplied,
  registerCanonicalServerUrl,
  resolveDeployServerUrl,
} from '../../lib/deployment';
import { hasLocalAuthSync } from '../../lib/local-auth-storage';
import { ApiClient } from '@dustnote/shared';
import { taroFetch } from '../../lib/taro-fetch';
import { APP_VERSION, useAuthStore } from '../../state/auth';
import { t, useLanguage } from '../../lib/i18n';
import { isPrivateHost } from '../../lib/net-utils';

/**
 * 检测当前运行时是否可支撑单机模式（本地 AES-GCM + HKDF）
 *
 * - 微信小程序（weapp）：基础库不提供 WebCrypto，但已由 crypto-polyfill 注入
 *   安全随机源（wx.getUserCryptoManager().getRandomValues）+ shared 纯 JS 加密
 *   回退（PBKDF2/HMAC/AES-GCM），单机模式可用，直接放行。
 * - 其他运行时（H5/支付宝/抖音等）：仍要求提供完整的 crypto.subtle，
 *   缺失时禁用单机模式。
 */
function isWebCryptoAvailable(): boolean {
  if (process.env.TARO_ENV === 'weapp') return true;
  try {
    const c = (globalThis as unknown as { crypto?: { subtle?: unknown } }).crypto;
    const subtle = c?.subtle;
    if (!subtle) return false;
    // 检查关键方法是否存在（不调用，避免触发权限弹窗）
    const s = subtle as Record<string, unknown>;
    return (
      typeof s.importKey === 'function' &&
      typeof s.encrypt === 'function' &&
      typeof s.decrypt === 'function' &&
      typeof s.sign === 'function'
    );
  } catch {
    return false;
  }
}

/**
 * 测试服务器连通性
 *
 * 调用 /auth/status 接口，返回 true 表示可连接。
 * 失败原因可能是：URL 错误、网络不通、服务器未启动等。
 */
async function testServerConnection(serverUrl: string): Promise<{ ok: boolean; message: string }> {
  const trimmed = serverUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return { ok: false, message: t('mode_select.err_empty_server') };
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return { ok: false, message: t('mode_select.err_server_prefix') };
  }
  try {
    const api = new ApiClient({
      baseUrl: `${trimmed}/api/v1`,
      clientVersion: APP_VERSION,
      platform: 'miniprogram',
      channel: 'stable',
      deviceId: 'connection-test',
      timeoutMs: 10000,
      fetch: process.env.TARO_ENV === 'weapp' ? taroFetch : undefined,
    });
    const r = await api.get<{ initialized: boolean }>('/auth/status');
    return {
      ok: true,
      message: r.initialized ? t('mode_select.ok_initialized') : t('mode_select.ok_uninitialized'),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : t('mode_select.err_connect');
    if (msg?.includes('abort') || msg?.includes('timeout')) {
      return { ok: false, message: t('mode_select.err_timeout') };
    }
    if (msg?.includes('fetch') || msg?.includes('network') || msg?.includes('Network')) {
      return { ok: false, message: t('mode_select.err_network') };
    }
    return { ok: false, message: msg };
  }
}

export default function ModeSelect() {
  const setMode = useModeStore((s) => s.setMode);
  const setServerUrl = useModeStore((s) => s.setServerUrl);
  const initialize = useModeStore((s) => s.initialize);
  const modeInitialized = useModeStore((s) => s.initialized);
  const currentMode = useModeStore((s) => s.mode);

  // 回填已保存的联机地址：从设置/切换模式再次进入时无需重填；
  // 已部署包无已存地址时预填部署预置值（用户可改）
  const [serverUrl, setServerUrlInput] = useState(
    (useModeStore.getState().serverUrl ?? DEPLOY_DEFAULT_SERVER_URL) || ''
  );
  const [testing, setTesting] = useState(false);
  const darkClass = useThemeDarkClass();
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const lang = useLanguage();
  // 部署引导解析中（新机首启）：避免选择 UI 闪现后被自动跳转打断
  const [resolvingDeploy, setResolvingDeploy] = useState(
    !!DEPLOY_DEFAULT_SERVER_URL && !isDeployDefaultApplied() && !useModeStore.getState().initialized
  );
  // 引导地址失效（预置地址连不上）：显示提示 + 手动输入，本轮不落库，下次启动重试
  const [bootstrapFailed, setBootstrapFailed] = useState(false);

  // 语言切换后同步原生导航栏标题
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('app.name') });
  }, [lang]);

  // 启动时检测 WebCrypto 可用性（决定单机模式是否可选）
  const cryptoAvailable = isWebCryptoAvailable();

  // 部署预置（一次性）：已发布包新机首启先到预置引导地址取「服务端登记的规范
  // 地址」（首次激活的设备已 POST 登记,见 lib/deployment.ts）,取到即以联机模式
  // 落库,直达解锁/初始化流程——新机免「选模式 + 输地址」；引导地址可达但尚无
  // 登记 → 回退用引导地址本身（它就是这台服务器）。引导地址不可达 → 显示地址
  // 失效提示,本轮不落库,下次启动自动重试。落库后由下方「已选过模式自动跳转」
  // effect 统一导航,这里不 reLaunch。
  useEffect(() => {
    if (modeInitialized) return;
    if (!DEPLOY_DEFAULT_SERVER_URL || isDeployDefaultApplied()) return;
    let cancelled = false;
    void (async () => {
      const r = await resolveDeployServerUrl(DEPLOY_DEFAULT_SERVER_URL);
      if (cancelled) return;
      setResolvingDeploy(false);
      if (!r.ok) {
        setBootstrapFailed(true);
        return;
      }
      markDeployDefaultApplied();
      setMode('online');
      setServerUrl(r.serverUrl);
      initialize();
      // AuthProvider 仅在 App 挂载时跑过一次 init（那时 mode 未定）,
      // 这里必须手动重跑鉴权初始化,否则 authState 停留在 unknown
      void useAuthStore.getState().init();
    })();
    return () => {
      cancelled = true;
    };
  }, [modeInitialized, setMode, setServerUrl, initialize]);

  // 已选过模式时自动跳转到对应流程（避免每次启动都显示模式选择页）
  useEffect(() => {
    if (!modeInitialized) return;
    if (currentMode === 'standalone') {
      Taro.reLaunch({
        url: hasLocalAuthSync()
          ? '/pages/standalone-unlock/index'
          : '/pages/standalone-setup/index',
      });
    } else {
      // 联机模式：跳转到 index 页面，由 useAuthStore.init 判断状态
      Taro.reLaunch({ url: '/pages/index/index' });
    }
  }, [modeInitialized, currentMode]);

  /** 选定单机模式：写入 mode-store，根据是否已设置主密码跳转
   *  当运行时不支持 WebCrypto 时禁用（单机模式依赖本地 AES-GCM + HKDF）
   */
  const chooseStandalone = () => {
    if (!cryptoAvailable) {
      Taro.showModal({
        title: t('mode_select.unsupported_title'),
        content: t('mode_select.unsupported_content'),
        showCancel: false,
        confirmText: t('mode_select.unsupported_ok'),
      });
      return;
    }
    setMode('standalone');
    setServerUrl(null);
    initialize();
    // 用户手动完成了选择：部署引导不再自动应用（否则 resetMode 后会被强拉回联机）
    markDeployDefaultApplied();
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
    // F14：首装/切换模式是服务器地址的**主入口**,此前只有设置页有明文 HTTP
    // 警告——公网明文链路上密文与派生凭据可被窃听,阻塞确认后再继续
    const trimmedForWarn = serverUrl.trim();
    if (/^http:\/\//i.test(trimmedForWarn) && !isPrivateHost(trimmedForWarn)) {
      const modal = await Taro.showModal({
        title: t('common.hint'),
        content: t('mode_select.warn_plain_http'),
        confirmText: t('common.confirm'),
        cancelText: t('common.cancel'),
      });
      if (!modal.confirm) return;
    }
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
      // 用户手动完成了选择：部署引导不再自动应用（否则 resetMode 后会被强拉回联机）
      markDeployDefaultApplied();
      // 首次激活：把连接成功的地址登记到服务端（先到先得），其它新设备经引导
      // 地址即可取到。失败静默——服务端未跑新版本/网络抖动都不阻塞激活
      void registerCanonicalServerUrl(trimmed);
      // AuthProvider 仅在 App 挂载时跑过一次 init（那时 mode 还是 null），
      // 这里必须手动重跑鉴权初始化，否则 authState 停留在 unknown，
      // index 页没有 unknown 守卫会直接渲染列表页
      void useAuthStore.getState().init();
      // 联机模式：跳转到 index 页面，由 useAuthStore.init 判断状态
      Taro.reLaunch({ url: '/pages/index/index' });
    } finally {
      setTesting(false);
    }
  };

  // 已初始化或部署引导解析中时不渲染选择 UI（避免跳转前闪烁）
  if (modeInitialized || resolvingDeploy) {
    return (
      <View className="hero">
        <Text className="hero-subtitle">{t('common.loading')}</Text>
      </View>
    );
  }

  return (
    <>
      <ThemeVars />
      <View className={`hero ${darkClass}`}>
        <Image src={logoUrl} className="hero-logo" style={{ width: '64px', height: '64px' }} />
        <Text className="hero-title">{t('mode_select.welcome')}</Text>
        <Text className="hero-subtitle">{t('mode_select.subtitle')}</Text>

        {/* 部署引导地址失效提示：预置地址连不上,引导用户改用新地址或去设置修改 */}
        {bootstrapFailed && (
          <View className="mint-card mt-m" style={{ width: '100%', maxWidth: '560rpx' }}>
            <Text className="text-sm error-text" style={{ display: 'block' }}>
              {t('mode_select.bootstrap_failed')}
            </Text>
          </View>
        )}

        {/* 单机模式入口 */}
        <View
          className="mint-card mt-l"
          style={{
            width: '100%',
            maxWidth: '560rpx',
            opacity: cryptoAvailable ? 1 : 0.5,
          }}
          onClick={chooseStandalone}
        >
          <View className="row" style={{ justifyContent: 'center' }}>
            <Text className="text-lg fw-bold">{t('mode_select.standalone')}</Text>
            <Text className="text-mint" style={{ marginLeft: '8rpx' }}>
              {cryptoAvailable ? '›' : ''}
            </Text>
          </View>
          <Text className="hint mt-s" style={{ display: 'block' }}>
            {t('mode_select.standalone_desc')}
          </Text>
          <Text className="text-xs text-muted mt-s" style={{ display: 'block' }}>
            {t('mode_select.standalone_suit')}
          </Text>
          {!cryptoAvailable && (
            <Text className="text-xs error-text mt-s" style={{ display: 'block' }}>
              {t('mode_select.webcrypto_warn')}
            </Text>
          )}
        </View>

        {/* 联机模式入口 */}
        <View className="mint-card mt-m" style={{ width: '100%', maxWidth: '560rpx' }}>
          <View className="row" style={{ justifyContent: 'center' }}>
            <Text className="text-lg fw-bold">{t('mode_select.online')}</Text>
            <Text className="text-mint" style={{ marginLeft: '8rpx' }}>
              ›
            </Text>
          </View>
          <Text className="hint mt-s" style={{ display: 'block' }}>
            {t('mode_select.online_desc')}
          </Text>
          <FInput
            className="mint-input mt-m"
            placeholder={'http://192.168.x.x:3210'}
            value={serverUrl}
            onInput={(e) => {
              const v = (e.detail as { value: string }).value;
              setServerUrlInput(v);
              return v;
            }}
          />
          {testResult && (
            <Text
              className={`text-xs mt-s ${testResult.ok ? 'success-text' : 'error-text'}`}
              style={{ display: 'block' }}
            >
              {testResult.message}
            </Text>
          )}
          <View className="row mt-m" style={{ justifyContent: 'center', gap: '16rpx' }}>
            <View
              className="mint-btn mint-btn-outline mint-btn-sm"
              style={{ opacity: testing ? 0.5 : 1, minWidth: '200rpx', boxSizing: 'border-box' }}
              onClick={onTestConnection}
            >
              {testing ? t('mode_select.testing') : t('mode_select.test_connection')}
            </View>
            <View
              className="mint-btn mint-btn-sm"
              style={{ opacity: testing ? 0.5 : 1, minWidth: '200rpx', boxSizing: 'border-box' }}
              onClick={chooseOnline}
            >
              {t('mode_select.enter_online')}
            </View>
          </View>
        </View>

        <Text className="text-xs text-muted mt-l" style={{ display: 'block', maxWidth: '560rpx' }}>
          {t('mode_select.tip')}
        </Text>
      </View>
    </>
  );
}
