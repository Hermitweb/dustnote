/**
 * auth 状态机测试（TEST-004 首批锁定用例）
 *
 * 聚焦 2026-09-24 真机审计暴露过的失败类别：
 * - 探测快速失败 → initFailed 置位（修复前永久 spinner）
 * - 探测慢速失败 + 看门狗已放行 → 不得把界面从解锁页拽走（护栏）
 * - lock() 的密钥延迟清零（M5：在途加密闭包防全零密钥）
 * - unlockWithBiometric 的 keychain 缓存路径
 * - standalone 模式绝不触网
 *
 * fetch 走桩（ApiClient 真实运行）；Keychain/AsyncStorage 走 test/mocks 内存桩。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { useModeStore } from '../lib/mode-store';
import { useAuthStore } from './auth';

const AS = AsyncStorage as unknown as { _store: Map<string, string>; clear(): Promise<void> };
const KC = Keychain as unknown as { _store: Map<string, unknown> };

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function resetStores(): Promise<void> {
  await AS.clear();
  KC._store.clear();
  useModeStore.setState({
    mode: 'online',
    serverUrl: 'http://test.local',
    initialized: true,
    hydrated: true,
  });
  useAuthStore.setState({
    authState: 'unknown',
    initFailed: false,
    pwSalt: null,
    masterKey: null,
    accessToken: null,
    userId: null,
    hasBiometricCache: false,
    localAuthBlob: null,
  });
}

describe('auth.init() 联机探测', () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetStores();
  });

  it('快速失败（断网 reject）→ unknown + initFailed=true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Network request failed');
      })
    );
    await useAuthStore.getState().init();
    const s = useAuthStore.getState();
    expect(s.authState).toBe('unknown');
    expect(s.initFailed).toBe(true);
  });

  it('成功 initialized:true → needs_unlock + pwSalt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonRes({ initialized: true, pwSalt: 'c2FsdA==', kdfParams: { algorithm: 'pbkdf2' } })
      )
    );
    await useAuthStore.getState().init();
    const s = useAuthStore.getState();
    expect(s.authState).toBe('needs_unlock');
    expect(s.pwSalt).toBe('c2FsdA==');
    expect(s.initFailed).toBe(false);
  });

  it('成功 initialized:false → uninitialized（进 setup）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonRes({ initialized: false, pwSalt: null }))
    );
    await useAuthStore.getState().init();
    expect(useAuthStore.getState().authState).toBe('uninitialized');
  });

  it('慢失败护栏：看门狗已放行 needs_unlock 后 init 失败不得拽回 unknown 错误页', async () => {
    // 模拟 5s 看门狗先置 needs_unlock（App.tsx 行为）
    useAuthStore.setState({ authState: 'needs_unlock' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Network request failed');
      })
    );
    await useAuthStore.getState().init();
    const s = useAuthStore.getState();
    // 护栏核心断言：正在输密码的界面没被整页换掉
    expect(s.authState).toBe('needs_unlock');
    expect(s.initFailed).toBe(false);
  });

  it('standalone 模式绝不触网', async () => {
    useModeStore.setState({ mode: 'standalone', serverUrl: null, initialized: true });
    const fetchSpy = vi.fn(async () => jsonRes({}));
    vi.stubGlobal('fetch', fetchSpy);
    await useAuthStore.getState().init();
    expect(fetchSpy).not.toHaveBeenCalled();
    // 本地无 auth blob → uninitialized（引导去 setup）
    expect(useAuthStore.getState().authState).toBe('uninitialized');
  });
});

describe('auth.lock() / 生物识别', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await resetStores();
  });

  it('lock() 立即置 needs_unlock + masterKey 内存引用摘除', () => {
    const key = new Uint8Array(32).fill(7);
    useAuthStore.setState({ authState: 'unlocked', masterKey: key });
    useAuthStore.getState().lock();
    const s = useAuthStore.getState();
    expect(s.authState).toBe('needs_unlock');
    expect(s.masterKey).toBeNull();
  });

  it('lock() 的密钥清零延迟 5s（M5 在途加密防全零密钥回归）', () => {
    vi.useFakeTimers();
    const key = new Uint8Array(32).fill(7);
    useAuthStore.setState({ authState: 'unlocked', masterKey: key });
    useAuthStore.getState().lock();
    // 立即：字节仍在（在途闭包还能安全完成，不会写出全零密文）
    expect(key[0]).toBe(7);
    vi.advanceTimersByTime(5_001);
    // 5s 后：内存卫生清零
    expect(key.every((b) => b === 0)).toBe(true);
    vi.useRealTimers();
  });

  it('unlockWithBiometric：keychain 有缓存 masterKey + token → unlocked', async () => {
    const key = new Uint8Array(32).fill(9);
    const b64 = Buffer.from(key).toString('base64');
    await Keychain.setGenericPassword('master', b64, { service: 'dustnote.master' });
    await AsyncStorage.setItem('dustnote_access_token', 'tok-123');
    await AsyncStorage.setItem('dustnote_user_id', 'user-1');
    vi.useFakeTimers(); // 拦住成功后的 setTimeout(refresh)
    const ok = await useAuthStore.getState().unlockWithBiometric();
    vi.useRealTimers();
    expect(ok).toBe(true);
    const s = useAuthStore.getState();
    expect(s.authState).toBe('unlocked');
    expect(s.masterKey).toEqual(key);
    expect(s.accessToken).toBe('tok-123');
    expect(s.userId).toBe('user-1');
  });

  it('unlockWithBiometric：keychain 无缓存 → false 且状态不动', async () => {
    const ok = await useAuthStore.getState().unlockWithBiometric();
    expect(ok).toBe(false);
    expect(useAuthStore.getState().authState).toBe('unknown');
  });
});
