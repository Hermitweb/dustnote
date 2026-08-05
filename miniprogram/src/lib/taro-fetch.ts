/**
 * 小程序（weapp）网络适配器
 *
 * 将 shared ApiClient 的 FetchFn 桥接到 Taro.request：
 * 小程序运行时没有 fetch / Headers（tech-architecture.md §6「Miniprogram 调 Taro.request」），
 * 联机模式所有 API 必须经 Taro.request 发出，否则运行时直接崩溃。
 *
 * 仅 weapp 构建走此适配器；H5 构建在浏览器环境，继续用默认 fetch。
 */
import Taro from '@tarojs/taro';
import type { FetchFn } from '@dustnote/shared';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export const taroFetch: FetchFn = (url, init) =>
  new Promise((resolve, reject) => {
    const method = METHODS.includes(init.method as (typeof METHODS)[number])
      ? (init.method as (typeof METHODS)[number])
      : 'GET';
    Taro.request({
      url,
      method,
      header: init.headers,
      // wx.request 对对象自动序列化为 JSON；body 是 shared 层 JSON.stringify 后的字符串
      data: init.body ? (JSON.parse(init.body) as unknown) : undefined,
      timeout: 30_000,
      success: (res) => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: String(res.statusCode),
          text: async () => {
            if (typeof res.data === 'string') return res.data;
            return res.data === undefined ? '' : JSON.stringify(res.data);
          },
        });
      },
      fail: (err) => reject(new Error(err.errMsg || '网络请求失败')),
    });
  });
