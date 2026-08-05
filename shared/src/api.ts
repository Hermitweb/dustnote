/**
 * API 客户端：跨端统一封装
 *
 * 自动注入 X-Client-* 头
 * 自动处理 401/410 状态码
 *
 * 网络实现可注入（FetchFn）：
 * - Web / RN / 桌面：默认使用全局 fetch
 * - 小程序（weapp）：注入 Taro.request 适配器（小程序运行时无 fetch/Headers）
 */

import type { ClientChannel, ClientPlatform } from './update-check.js';

export interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}

/** 跨端网络实现签名（body 为 JSON 字符串；二进制上传走默认 fetch） */
export type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<FetchResponse>;

export interface ApiClientOptions {
  baseUrl: string;
  clientVersion: string;
  platform: ClientPlatform;
  channel: ClientChannel;
  deviceId: string;
  /** 当前 access token（可选） */
  accessToken?: string | undefined;
  /** 自定义网络实现（小程序等无 fetch 环境） */
  fetch?: FetchFn;
}

export interface ApiError {
  status: number;
  code: string;
  message: string;
  data?: unknown;
}

export class ApiException extends Error {
  override readonly name = 'ApiException';
  constructor(public readonly err: ApiError) {
    super(err.message);
  }
}

/** 默认实现：全局 fetch（Web / RN / 桌面） */
const defaultFetch: FetchFn = async (url, init) => {
  const res = await fetch(url, {
    method: init.method,
    headers: init.headers as unknown as HeadersInit,
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    text: () => res.text(),
  };
};

export class ApiClient {
  constructor(private readonly opts: ApiClientOptions) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...(extra ?? {}) };
    h['X-Client-Version'] = this.opts.clientVersion;
    h['X-Client-Platform'] = this.opts.platform;
    h['X-Client-Channel'] = this.opts.channel;
    h['X-Client-Device-Id'] = this.opts.deviceId;
    if (this.opts.accessToken) {
      h['Authorization'] = `Bearer ${this.opts.accessToken}`;
    }
    if (h['Content-Type'] === undefined && extra === undefined) {
      h['Content-Type'] = 'application/json';
    }
    return h;
  }

  async request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
    const url = `${this.opts.baseUrl}${path}`;
    const headers = this.headers(init?.headers as Record<string, string> | undefined);

    // 二进制请求体（FormData/Blob/ArrayBuffer）：仅默认 fetch 支持，走原生通路
    if (body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer) {
      delete headers['Content-Type'];
      const res = await fetch(url, {
        ...init,
        method,
        headers: headers as unknown as HeadersInit,
        body: body as BodyInit,
      });
      return this.parseResponse<T>(res);
    }

    let payload: string | undefined;
    if (body !== undefined) {
      payload = JSON.stringify(body);
    } else if (init?.body) {
      payload = typeof init.body === 'string' ? init.body : undefined;
    }

    const fetchImpl = this.opts.fetch ?? defaultFetch;
    const res = await fetchImpl(url, {
      method,
      headers,
      ...(payload !== undefined ? { body: payload } : {}),
    });
    return this.parseResponse<T>(res);
  }

  private async parseResponse<T>(res: FetchResponse): Promise<T> {
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;

    if (!res.ok) {
      const errObj = (data ?? {}) as { error?: string; message?: string };
      throw new ApiException({
        status: res.status,
        code: errObj.error ?? 'unknown',
        message: errObj.message ?? res.statusText,
        data: data ?? undefined,
      });
    }

    return data as T;
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body);
  }
  put<T>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, body);
  }
  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  delete<T>(path: string) {
    return this.request<T>('DELETE', path);
  }
}
