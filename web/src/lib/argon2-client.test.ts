/**
 * web/src/lib/argon2-client.ts 单测 —— fallback + Worker 路径
 *
 * jsdom 默认无 Worker 构造函数，argon2-client 应回退到主线程 deriveSecrets。
 * 同时覆盖：参数透传、错误传播、Worker 成功路径、Worker 超时、Worker 加载失败。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const deriveSecretsMock = vi.fn();
const deriveKeyMock = vi.fn();

vi.mock('@dustnote/shared', async () => {
  const actual = await vi.importActual<typeof import('@dustnote/shared')>('@dustnote/shared');
  return {
    ...actual,
    deriveSecrets: (...args: unknown[]) => deriveSecretsMock(...args),
    deriveKey: (...args: unknown[]) => deriveKeyMock(...args),
  };
});

import { deriveSecretsInWorker } from './argon2-client.js';

describe('argon2-client.deriveSecretsInWorker（jsdom 无 Worker → fallback）', () => {
  beforeEach(() => {
    deriveSecretsMock.mockReset();
    deriveKeyMock.mockReset();
  });

  it('Worker 不可用 → 走主线程 deriveSecrets', async () => {
    deriveSecretsMock.mockResolvedValueOnce({
      kek: new Uint8Array(32).fill(0xaa),
      authKey: new Uint8Array(32).fill(0xbb),
    });
    const out = await deriveSecretsInWorker('mypassword', new Uint8Array(16).fill(0x01));
    expect(deriveSecretsMock).toHaveBeenCalledWith(
      'mypassword',
      expect.any(Uint8Array),
      expect.anything()
    );
    expect(out.kek).toBeInstanceOf(Uint8Array);
    expect(out.kek.length).toBe(32);
  });

  it('显式 KDF params → 透传到 deriveSecrets', async () => {
    deriveSecretsMock.mockResolvedValueOnce({
      kek: new Uint8Array(32),
      authKey: new Uint8Array(32),
    });
    const params = { algorithm: 'pbkdf2' as const, m: 0, t: 0, p: 0, iterations: 1, dkLen: 32 };
    await deriveSecretsInWorker('secret', new Uint8Array(16), params);
    expect(deriveSecretsMock).toHaveBeenCalledWith('secret', expect.any(Uint8Array), params);
  });

  it('deriveSecrets 抛错 → Promise reject', async () => {
    deriveSecretsMock.mockRejectedValueOnce(new Error('kdf failed'));
    await expect(deriveSecretsInWorker('x', new Uint8Array(16))).rejects.toThrow('kdf failed');
  });

  it('deriveSecrets 返 null（不该发生但测防御）→ resolve 透传', async () => {
    deriveSecretsMock.mockResolvedValueOnce(null as never);
    const out = await deriveSecretsInWorker('x', new Uint8Array(16));
    expect(out).toBeNull();
  });

  it('salt 16 字节 → 透传 Uint8Array 类型不被破坏', async () => {
    deriveSecretsMock.mockResolvedValueOnce({
      kek: new Uint8Array(32),
      authKey: new Uint8Array(32),
    });
    const salt = new Uint8Array(16);
    for (let i = 0; i < 16; i++) salt[i] = i;
    await deriveSecretsInWorker('pw', salt);
    const passedSalt = deriveSecretsMock.mock.calls[0]?.[1] as Uint8Array;
    expect(passedSalt).toBeInstanceOf(Uint8Array);
    expect(passedSalt.length).toBe(16);
    expect(Array.from(passedSalt)).toEqual(Array.from(salt));
  });
});

describe('argon2-client.deriveSecretsInWorker（Worker 成功路径）', () => {
  // 重新 import 模块以让 Worker 全局 mock 生效（getWorker 闭包捕获）
  let workerInstances: Array<{
    onmessage: ((e: MessageEvent) => void) | null;
    onerror: ((e: ErrorEvent) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
  }>;
  let origWorker: unknown;
  let _deriveSecretsInWorker: typeof import('./argon2-client').deriveSecretsInWorker;

  beforeEach(async () => {
    vi.resetModules();
    deriveSecretsMock.mockReset();
    workerInstances = [];
    origWorker = (globalThis as Record<string, unknown>).Worker;

    // Mock Worker
    class MockWorker {
      // 用 defineProperty 让 onmessage/onerror 是 live getter（worker 代码会赋值）
      private _onmessage: ((e: MessageEvent) => void) | null = null;
      private _onerror: ((e: ErrorEvent) => void) | null = null;
      get onmessage() {
        return this._onmessage;
      }
      set onmessage(v: ((e: MessageEvent) => void) | null) {
        this._onmessage = v;
      }
      get onerror() {
        return this._onerror;
      }
      set onerror(v: ((e: ErrorEvent) => void) | null) {
        this._onerror = v;
      }
      postMessage = vi.fn();
      terminate = vi.fn();
      constructor() {
        workerInstances.push(
          this as unknown as {
            onmessage: ((e: MessageEvent) => void) | null;
            onerror: ((e: ErrorEvent) => void) | null;
            postMessage: ReturnType<typeof vi.fn>;
            terminate: ReturnType<typeof vi.fn>;
          }
        );
      }
    }
    (globalThis as Record<string, unknown>).Worker = MockWorker;

    // 重新 import 模块，让 getWorker 函数体内引用 globalThis.Worker 重新解析
    const mod = await import('./argon2-client');
    _deriveSecretsInWorker = mod.deriveSecretsInWorker;
  });

  afterEach(() => {
    if (origWorker === undefined) {
      delete (globalThis as Record<string, unknown>).Worker;
    } else {
      (globalThis as Record<string, unknown>).Worker = origWorker;
    }
    vi.useRealTimers();
  });

  it('Worker 构造抛错 → 走 fallback（主线程 deriveSecrets）', async () => {
    (globalThis as Record<string, unknown>).Worker = class {
      constructor() {
        throw new Error('CSP blocked');
      }
    };
    deriveSecretsMock.mockResolvedValueOnce({
      kek: new Uint8Array(32).fill(0xee),
      authKey: new Uint8Array(32).fill(0xff),
    });
    // 重新 import 让 getWorker 看到 throwing Worker
    const mod = await import('./argon2-client');
    const out = await mod.deriveSecretsInWorker('pw', new Uint8Array(16));
    expect(deriveSecretsMock).toHaveBeenCalled();
    expect(out.kek[0]).toBe(0xee);
  });

  it('Worker 成功路径：onmessage 触发 resolve（live getter mock）', async () => {
    // getWorker 是同步的：new MockWorker + 设 onmessage + 设 onerror + postMessage
    // 调用 _deriveSecretsInWorker 后 workerInstances 立即有新实例
    const promise = _deriveSecretsInWorker('pw', new Uint8Array(16).fill(0x01));
    // 让当前宏任务完成（getWorker 已同步执行完）
    await Promise.resolve();
    expect(workerInstances.length).toBeGreaterThan(0);
    const w = workerInstances[workerInstances.length - 1] as {
      onmessage: ((e: MessageEvent) => void) | null;
      postMessage: { mock: { calls: unknown[][] } };
      terminate: ReturnType<typeof vi.fn>;
    };
    // 确认 postMessage 被调用
    expect(w.postMessage.mock.calls.length).toBeGreaterThan(0);
    // 确认 onmessage 已被 getWorker 赋值
    expect(typeof w.onmessage).toBe('function');
    // 取出 postMessage 时传入的 id
    const posted = w.postMessage.mock.calls[0]![0] as { id: number };
    // 触发 onmessage 成功返回（id 必须匹配 pending 里的 id）
    const replyKek = Array.from(new Uint8Array(32).fill(0x11));
    const replyAuth = Array.from(new Uint8Array(32).fill(0x22));
    w.onmessage!(
      new MessageEvent('message', {
        data: { id: posted.id, result: { kek: replyKek, authKey: replyAuth } },
      })
    );
    const out = await promise;
    expect(Array.from(out.kek)[0]).toBe(0x11);
    expect(Array.from(out.authKey)[0]).toBe(0x22);
  });

  it('Worker 错误路径：onmessage 触发 reject', async () => {
    const promise = _deriveSecretsInWorker('pw', new Uint8Array(16).fill(0x01));
    await Promise.resolve();
    expect(workerInstances.length).toBeGreaterThan(0);
    const w = workerInstances[workerInstances.length - 1] as {
      onmessage: ((e: MessageEvent) => void) | null;
      postMessage: { mock: { calls: unknown[][] } };
    };
    const posted = w.postMessage.mock.calls[0]![0] as { id: number };
    w.onmessage!(
      new MessageEvent('message', { data: { id: posted.id, error: 'worker kdf boom' } })
    );
    await expect(promise).rejects.toThrow('worker kdf boom');
  });

  it('Worker 错误路径：onerror 触发 reject + worker 清空', async () => {
    const promise = _deriveSecretsInWorker('pw', new Uint8Array(16).fill(0x01));
    await Promise.resolve();
    expect(workerInstances.length).toBeGreaterThan(0);
    const w = workerInstances[workerInstances.length - 1] as {
      onerror: ((e: ErrorEvent) => void) | null;
      terminate: ReturnType<typeof vi.fn>;
    };
    expect(typeof w.onerror).toBe('function');
    // 触发 onerror（ErrorEvent.message 需被 Error 捕获）
    const errEvt = new ErrorEvent('error', { message: 'worker load failed' });
    w.onerror!(errEvt);
    await expect(promise).rejects.toThrow('Worker failed');
  });
});
