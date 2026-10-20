/**
 * repository 工厂测试
 */
import { describe, it, expect, vi } from 'vitest';

const localStub = vi.fn();
const remoteStub = vi.fn();

vi.mock('./local-repo', () => ({
  LocalRepository: class {
    constructor() {
      localStub();
    }
  },
}));
vi.mock('./remote-repo', () => ({
  RemoteRepository: class {
    constructor(getAccessToken: () => string | null) {
      remoteStub(getAccessToken);
    }
  },
}));

import { createRepository } from './repository';

describe('createRepository', () => {
  it('standalone mode → 创建 LocalRepository', () => {
    localStub.mockClear();
    createRepository({ mode: 'standalone' } as never);
    expect(localStub).toHaveBeenCalled();
    expect(remoteStub).not.toHaveBeenCalled();
  });

  it('online mode 但缺 getAccessToken → throw', () => {
    expect(() => createRepository({ mode: 'online' } as never)).toThrow(/getAccessToken/);
  });

  it('online mode + 提供 getAccessToken → 创建 RemoteRepository', () => {
    remoteStub.mockClear();
    const getToken = () => 'tk';
    createRepository({ mode: 'online' } as never, getToken);
    expect(remoteStub).toHaveBeenCalled();
    expect(remoteStub.mock.calls[0]![0]).toBe(getToken);
  });
});
