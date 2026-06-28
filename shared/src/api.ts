/**
 * API 客户端：跨端统一封装
 *
 * 自动注入 X-Client-* 头
 * 自动处理 401/410 状态码
 */

import type { ClientChannel, ClientPlatform } from './update-check.js';

export interface ApiClientOptions {
  baseUrl: string;
  clientVersion: string;
  platform: ClientPlatform;
  channel: ClientChannel;
  deviceId: string;
  /** 当前 access token（可选） */
  accessToken?: string | undefined;
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

export class ApiClient {
  constructor(private readonly opts: ApiClientOptions) {}

  private headers(extra?: HeadersInit): Headers {
    const h = new Headers(extra);
    h.set('X-Client-Version', this.opts.clientVersion);
    h.set('X-Client-Platform', this.opts.platform);
    h.set('X-Client-Channel', this.opts.channel);
    h.set('X-Client-Device-Id', this.opts.deviceId);
    if (this.opts.accessToken) {
      h.set('Authorization', `Bearer ${this.opts.accessToken}`);
    }
    if (!h.has('Content-Type') && extra === undefined) {
      h.set('Content-Type', 'application/json');
    }
    return h;
  }

  async request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
    const url = `${this.opts.baseUrl}${path}`;
    const headers = this.headers(init?.headers);

    let payload: BodyInit | null = null;
    if (body !== undefined) {
      if (body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer) {
        payload = body as BodyInit;
        headers.delete('Content-Type');
      } else {
        payload = JSON.stringify(body);
      }
    } else if (init?.body) {
      payload = init.body as BodyInit;
    }

    const res = await fetch(url, { ...init, method, headers, body: payload });
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
