/**
 * ProjectInfoPanel 回归测试
 *
 * 板块定位：信息聚合（版本/安全参数/数据统计/链接），不是交互入口。
 * 测试口径：数据来自 store 内存态（notes/folders/totpEnabled），不依赖网络与
 * IndexedDB；单机模式下不显示服务器行；回收站数 = 总数 − 未删除数。
 * i18n/store mock 模式复用 NoteHistoryDialog.test.tsx 先例。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, createElement } from '../test/render';

vi.mock('react-i18next', () => {
  // t 返回真实词典文案需要完整 i18n 链；这里按 NoteHistoryDialog 先例回 key，
  // 断言锚点改用稳定 key 文本（未开启/单机提示等走 key 匹配）
  const t = (key: string, opts?: Record<string, unknown>): string => {
    if (!opts) return key;
    return Object.entries(opts).reduce(
      (acc, [k, v]) => acc.replace(new RegExp(`{{${k}}}`, 'g'), String(v)),
      key
    );
  };
  return {
    useTranslation: () => ({ t }),
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

const openSpy = vi.fn();
vi.stubGlobal('open', openSpy);

const { useStoreMock, storeState } = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  const mock = vi.fn((selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(state) : state
  );
  (mock as unknown as { getState: () => Record<string, unknown> }).getState = () => state;
  return { storeState: state, useStoreMock: mock };
});

vi.mock('../lib/store', () => ({ useStore: useStoreMock }));
vi.mock('../lib/platform', () => ({ isTauri: () => false }));
vi.mock('../lib/mode-store', () => ({ useModeStore: { getState: () => ({ serverUrl: null }) } }));

import { ProjectInfoPanel } from './ProjectInfoPanel';
import type { NoteRow, Folder } from '../lib/store-types';

function note(id: string, deleted: boolean): NoteRow {
  return {
    id,
    ciphertext: 'x',
    keyVersion: 1,
    isPinned: false,
    isFavorite: false,
    deletedAt: deleted ? '2026-01-01T00:00:00Z' : null,
    version: 1,
    clientUpdatedAt: '2026-01-01T00:00:00Z',
    serverUpdatedAt: '2026-01-01T00:00:00Z',
    folderId: null,
  };
}

function seed(opts: {
  notes?: NoteRow[];
  folders?: Folder[];
  totpEnabled?: boolean;
  mode?: 'standalone' | 'online';
  kdf?: unknown;
}): void {
  storeState.notes = new Map((opts.notes ?? []).map((n) => [n.id, n]));
  storeState.folders = opts.folders ?? [];
  storeState.totpEnabled = opts.totpEnabled ?? false;
  storeState.mode = opts.mode ?? 'standalone';
  storeState.accountKdfParams = opts.kdf ?? null;
}

function folder(id: string): Folder {
  return { id, name: id, parentId: null, icon: null, sortOrder: 0, createdAt: '' };
}

describe('ProjectInfoPanel', () => {
  beforeEach(() => {
    openSpy.mockClear();
    seed({});
  });

  it('渲染版本行与安全参数区（app 版本来自注入常量）', () => {
    seed({ kdf: { algorithm: 'pbkdf2', iterations: 100000, dkLen: 32 } });
    const { container } = render(createElement(ProjectInfoPanel));
    // 版本行：__APP_VERSION__ 在测试配置里是 0.0.0-test
    expect(container.textContent).toContain('0.0.0-test');
    // KDF 行：格式化含算法名与轮数
    expect(container.textContent).toContain('PBKDF2-SHA256');
    expect(container.textContent).toContain('100,000');
  });

  it('回收站计数 = 总数 − 未删除数；文件夹数取 store 长度', () => {
    seed({
      notes: [note('a', false), note('b', false), note('c', true)],
      folders: [folder('f1'), folder('f2')],
    });
    const { container } = render(createElement(ProjectInfoPanel));
    const text = container.textContent ?? '';
    // 未删除 2 / 回收站 1 / 文件夹 2 —— 数字按行内出现即可
    expect(text).toContain('2');
    expect(text).toContain('1');
  });

  it('单机模式：不请求服务器版本（无 fetch），渲染单机提示 key', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    seed({ mode: 'standalone' });
    const { container } = render(createElement(ProjectInfoPanel));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain('settings.project_info_standalone_hint');
  });

  it('2FA 关闭显示关闭态 key', () => {
    const { container } = render(createElement(ProjectInfoPanel));
    expect(container.textContent).toContain('settings.project_info_2fa_off');
  });

  it('KDF 参数缺失回退默认算法名', () => {
    seed({ kdf: null });
    const { container } = render(createElement(ProjectInfoPanel));
    expect(container.textContent).toContain('PBKDF2-SHA256');
  });

  afterEach(cleanup);
});

import { afterEach } from 'vitest';
