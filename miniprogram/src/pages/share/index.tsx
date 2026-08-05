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
import { decryptString, fromBase64Url, isCiphertext } from '@dustnote/shared';
import { getCurrentMode } from '../../lib/mode-store';
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

  useEffect(() => {
    if (!token) return;
    void load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const load = async (pwd: string) => {
    try {
      const apiBase = resolveApiBase();
      if (!apiBase) {
        setError('未配置服务器地址，请先在主应用中选择联机模式并填写服务器地址');
        return;
      }
      // 密码通过 POST body 传输，避免出现在 URL/访问日志中
      const url = `${apiBase}/share/public/${token}`;
      const res = await Taro.request({
        url,
        method: 'POST',
        data: pwd ? { password: pwd } : {},
        header: { 'X-Client-Platform': 'miniprogram', 'Content-Type': 'application/json' },
      });
      if (res.statusCode === 401) {
        const e = (res.data as { error?: string }).error;
        if (e === 'password_required') {
          setNeedsPassword(true);
          return;
        }
        if (e === 'invalid_password') {
          setError('密码错误');
          return;
        }
      }
      if (res.statusCode === 423) {
        const errData = res.data as { message?: string };
        setError(errData.message ? errData.message : '该分享已被锁定，请稍后再试');
        return;
      }
      if (res.statusCode === 410) {
        const errData = res.data as { message?: string };
        setError(errData.message ? errData.message : '分享已失效');
        return;
      }
      if (res.statusCode === 200) {
        if (!keyParam) {
          setError('链接不完整：缺少解密密钥，请使用完整的分享链接');
          return;
        }
        const data = res.data as { ciphertext?: unknown };
        if (!isCiphertext(data.ciphertext)) {
          setError('分享数据格式异常');
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
          setError('解密失败：密钥与该分享不匹配');
        }
      } else {
        setError('加载失败');
      }
    } catch {
      setError('网络错误');
    }
  };

  if (!token) {
    return (
      <View className="empty-state">
        <Text className="empty-state-icon">⚠️</Text>
        <Text className="empty-state-text">无效的分享链接</Text>
      </View>
    );
  }

  if (needsPassword) {
    return (
      <View className="hero">
        <Text className="hero-title">🔐 需要密码</Text>
        <Input
          className="mint-input"
          password
          placeholder="分享密码"
          value={password}
          onInput={(e) => setPassword((e.detail as { value: string }).value)}
        />
        <View className="mint-btn mint-btn-block mt-m" onClick={() => load(password)}>
          解锁
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
    return <View className="loading">加载中…</View>;
  }

  return (
    <View className="page px-page">
      <View className="share-banner" />
      <Text className="text-xs text-muted">🌿 DustNote 分享</Text>
      <Text className="text-lg fw-bold mt-m mb-l">{title}</Text>
      <View className="share-content">
        <Markdown content={content} />
      </View>
      <View className="text-center text-xs text-muted mt-l">
        <Text>由 DustNote 分享</Text>
      </View>
    </View>
  );
}
