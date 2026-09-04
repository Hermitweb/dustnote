/**
 * 访客分享查看页（公开）
 *
 * 该页面无需登录态，故不走 ApiClient（其会注入 Bearer token）。
 * 直接使用 Taro.request 跨端调用：
 *   - H5：相对路径 /api/v1/share/public/<token>，走 devServer proxy
 *   - weapp：宿主机局域网 IP（需在开发者工具勾选「不校验合法域名」）
 */
import React, { useState, useEffect } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { ThemeVars } from '../../components/ThemeVars';
import { decryptString, fromBase64Url, isCiphertext } from '@dustnote/shared';
import { getCurrentMode } from '../../lib/mode-store';
import { t, useLanguage } from '../../lib/i18n';
import Markdown from '../../lib/markdown';

/**
 * 解析 API base：
 * - H5：相对路径 /api/v1（走 devServer proxy 或同源部署）
 * - weapp / 其他小程序：从 mode-store 读取用户在 mode-select 配置过的 serverUrl
 *   若未配置则回退到空串，调用时由 UI 提示用户先在主应用配置服务器地址
 */
function resolveApiBase(): string {
  if (process.env.TARO_ENV === 'h5') return '/api/v1';
  const { serverUrl } = getCurrentMode();
  if (!serverUrl) return '';
  return `${serverUrl.replace(/\/+$/, '')}/api/v1`;
}

export default function Share() {
  const instance = Taro.getCurrentInstance();
  const params = (instance && instance.router && instance.router.params) || {};
  const token = params.token;
  // 解密密钥来自链接参数，从不经过服务端
  const keyParam = params.key;
  const [password, setPassword] = useState('');
  const [title, setTitle] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lang = useLanguage();

  // 语言切换后同步原生导航栏标题
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('app.name') });
  }, [lang]);

  useEffect(() => {
    if (!token) return;
    void load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const load = async (pwd: string) => {
    try {
      const apiBase = resolveApiBase();
      if (!apiBase) {
        setError(t('share.err_no_server'));
        return;
      }
      // 密码通过 POST body 传输，避免出现在 URL/访问日志中
      const url = `${apiBase}/share/public/${token}`;
      const res = await Taro.request({
        url,
        method: 'POST',
        data: pwd ? { password: pwd } : {},
        header: { 'X-Client-Platform': 'miniprogram', 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      if (res.statusCode === 401) {
        const e = (res.data as { error?: string }).error;
        if (e === 'password_required') {
          setNeedsPassword(true);
          return;
        }
        if (e === 'invalid_password') {
          setError(t('share.err_wrong_pwd'));
          return;
        }
      }
      if (res.statusCode === 423) {
        const errData = res.data as { message?: string };
        setError(errData.message ? errData.message : t('share.err_locked'));
        return;
      }
      if (res.statusCode === 410) {
        const errData = res.data as { message?: string };
        setError(errData.message ? errData.message : t('share.err_expired'));
        return;
      }
      if (res.statusCode === 200) {
        if (!keyParam) {
          setError(t('share.err_incomplete'));
          return;
        }
        const data = res.data as { ciphertext?: unknown };
        if (!isCiphertext(data.ciphertext)) {
          setError(t('share.err_format'));
          return;
        }
        try {
          const plain = JSON.parse(
            await decryptString(fromBase64Url(keyParam), data.ciphertext)
          ) as { title: string; content: string };
          setTitle(plain.title);
          setContent(plain.content);
          setNeedsPassword(false);
          setError(null);
        } catch {
          setError(t('share.err_decrypt'));
        }
      } else {
        setError(t('common.load_failed'));
      }
    } catch (err) {
      setError((err as { errMsg?: string })?.errMsg || t('share.err_network'));
    }
  };

  if (!token) {
    return (
      <View className="empty-state">
        <Text className="empty-state-icon">⚠️</Text>
        <Text className="empty-state-text">{t('share.invalid_link')}</Text>
      </View>
    );
  }

  if (needsPassword) {
    return (
      <View className="hero">
        <Text className="hero-title">{t('share.need_pwd')}</Text>
        <Input
          className="mint-input"
          password
          placeholder={t('share.pwd_placeholder')}
          value={password}
          onInput={(e) => setPassword((e.detail as { value: string }).value)}
        />
        <View className="mint-btn mint-btn-block mt-m" onClick={() => load(password)}>
          {t('common.unlock')}
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View className="empty-state">
        <Text className="empty-state-icon">⚠️</Text>
        <Text className="empty-state-text">{error}</Text>
      </View>
    );
  }

  if (!title || !content) {
    return <View className="loading">{t('common.loading')}</View>;
  }

  return (
    <>
      <ThemeVars />
    <View className="page px-page">
      <View className="share-banner" />
      <Text className="text-xs text-muted">{t('share.banner')}</Text>
      <Text className="text-lg fw-bold mt-m mb-l">{title}</Text>
      <View className="share-content">
        <Markdown content={content} />
      </View>
      <View className="text-center text-xs text-muted mt-l">
        <Text>{t('share.footer')}</Text>
      </View>
    </View>
    </>
  );
}
