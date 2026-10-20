/**
 * remote-repo 测试
 *
 * RemoteRepository 继承 @dustnote/client-core 的 CoreRemoteRepository，
 * 我们只验证 web 端构造路径（创建 ApiClient + 透传 getAccessToken）。
 */
import { describe, it, expect, vi } from 'vitest';
import { RemoteRepository, loadWrappedMasterKey } from './remote-repo';

vi.mock('./mode-store', () => ({
  getCurrentMode: () => ({ serverUrl: null }),
}));
vi.mock('./device', () => ({
  getDeviceId: () => 'device-123',
}));

const coreStub = vi.fn();
vi.mock('@dustnote/client-core', () => ({
  RemoteRepository: class {
    constructor(apiProvider: unknown, opts: unknown) {
      coreStub(apiProvider, opts);
    }
    getWrappedMasterKey(...args: unknown[]) {
      return (
        this as unknown as { _getWrappedMasterKey: (...args: unknown[]) => unknown }
      )._getWrappedMasterKey?.(...args);
    }
  },
}));

describe('RemoteRepository', () => {
  it('构造时透传 getAccessToken 到父类 ApiClient factory', () => {
    const getToken = () => 'tk-1';
    new RemoteRepository(getToken);
    expect(coreStub).toHaveBeenCalled();
    const [provider] = coreStub.mock.calls[0]! as [() => unknown];
    expect(typeof provider).toBe('function');
    expect(provider()).toBeDefined();
  });

  it('loadWrappedMasterKey 401 / 错误 → 返回 null', async () => {
    global.fetch = vi.fn(
      async () => new Response('{}', { status: 401 })
    ) as unknown as typeof fetch;
    const r = await loadWrappedMasterKey('tk');
    expect(r).toBeNull();
  });
});
