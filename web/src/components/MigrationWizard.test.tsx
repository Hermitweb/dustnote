/**
 * MigrationWizard 测试
 *
 * 覆盖：
 * - 渲染标题与导出/导入区块
 * - 点击导出触发下载（href/download 属性 + Blob）
 * - 导入有效 JSON 调 setPreferences + modeStore 状态恢复
 * - 导入 magic 不匹配 → 错误 toast
 * - 导入 mode 非法 → 错误 toast
 * - 导入 serverUrl 非合法 URL → 错误 toast
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';

/** 触发 file input 的 change 事件（jsdom 不允许 .files 直接赋值） */
function triggerFileChange(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', {
    get: () => [file],
    configurable: true,
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** 构造一个会返回特定文本的 File */
function makeFile(text: string, name = 'env.json'): File {
  const file = new File([text], name, { type: 'application/json' });
  file.text = () => Promise.resolve(text);
  return file;
}

const mockSetPreferences = vi.fn();
let mockPreferences: Record<string, unknown> = { language: 'zh-CN', theme: 'auto' };
let mockMode: string = 'standalone';
let mockServerUrl: string | null = null;
let mockInitialized = true;

const mockSetMode = vi.fn();
const mockSetServerUrl = vi.fn();
const mockInitialize = vi.fn();

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

let mockFileTextResult = '{}';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => (opts ? `${k}:${JSON.stringify(opts)}` : k),
    i18n: { language: 'zh-CN' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('../lib/store', () => ({
  useStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        preferences: mockPreferences,
        setPreferences: mockSetPreferences,
      }),
    { getState: () => ({ preferences: mockPreferences, setPreferences: mockSetPreferences }) }
  ),
}));

vi.mock('../lib/mode-store', () => ({
  useModeStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) =>
      selector
        ? selector({
            mode: mockMode,
            serverUrl: mockServerUrl,
            initialized: mockInitialized,
          })
        : undefined,
    {
      getState: () => ({
        mode: mockMode,
        serverUrl: mockServerUrl,
        initialized: mockInitialized,
        setMode: mockSetMode,
        setServerUrl: mockSetServerUrl,
        initialize: mockInitialize,
      }),
    }
  ),
}));

vi.mock('../lib/toast', () => ({
  toast: {
    success: (msg: string) => mockToastSuccess(msg),
    error: (msg: string) => mockToastError(msg),
  },
}));

import { MigrationWizard } from './MigrationWizard';

const originalLocation = window.location;

describe('MigrationWizard', () => {
  beforeEach(() => {
    mockSetPreferences.mockClear();
    mockSetMode.mockClear();
    mockSetServerUrl.mockClear();
    mockInitialize.mockClear();
    mockToastSuccess.mockClear();
    mockToastError.mockClear();
    mockPreferences = { language: 'zh-CN', theme: 'auto' };
    mockMode = 'standalone';
    mockServerUrl = null;
    mockInitialized = true;
    mockFileTextResult = '{}';
    // location.reload 必须 stub，否则触发导航
    Object.defineProperty(window, 'location', {
      value: { reload: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('渲染标题与导出/导入两块', () => {
    const { container } = render(<MigrationWizard onClose={() => undefined} />);
    expect(container.textContent).toContain('migration.title');
    expect(container.textContent).toContain('migration.export_title');
    expect(container.textContent).toContain('migration.import_title');
  });

  it('点击导出按钮触发下载', () => {
    const { container } = render(<MigrationWizard onClose={() => undefined} />);
    const exportBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('migration.export_btn')
    );
    expect(exportBtn).toBeDefined();
    // stub URL.createObjectURL 防止 jsdom warning
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    let capturedDownload = '';
    let clickCount = 0;
    const origAppendChild = document.body.appendChild.bind(document.body);
    const origRemoveChild = document.body.removeChild.bind(document.body);
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(((node: Node) => {
      if (node instanceof HTMLAnchorElement) {
        capturedDownload = node.download;
        clickCount += 1;
        node.click();
        return node;
      }
      return origAppendChild(node);
    }) as typeof document.body.appendChild);
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(((node: Node) => {
      if (node instanceof HTMLAnchorElement) return node;
      return origRemoveChild(node);
    }) as typeof document.body.removeChild);

    fireEvent.click(exportBtn!);
    expect(capturedDownload).toBe('dustnote-env.json');
    expect(clickCount).toBe(1);
    expect(mockToastSuccess).toHaveBeenCalledWith('migration.export_done');

    appendSpy.mockRestore();
    removeSpy.mockRestore();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it('导入有效 JSON：恢复 preferences 与 mode', async () => {
    mockFileTextResult = JSON.stringify({
      magic: 'dustnote-env',
      version: 1,
      exportedAt: '2025-01-01T00:00:00Z',
      preferences: { language: 'en', theme: 'dark' },
      modeState: { mode: 'online', serverUrl: 'https://example.com', initialized: true },
    });
    mockSetMode.mockReturnValue(undefined);
    mockSetServerUrl.mockReturnValue(undefined);

    const { container } = render(<MigrationWizard onClose={() => undefined} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    triggerFileChange(fileInput, makeFile(mockFileTextResult));

    // 等待 microtask 完成
    await new Promise((r) => setTimeout(r, 50));
    expect(mockSetPreferences).toHaveBeenCalledWith({ language: 'en', theme: 'dark' });
    expect(mockSetMode).toHaveBeenCalledWith('online');
    expect(mockSetServerUrl).toHaveBeenCalledWith('https://example.com');
    expect(mockInitialize).toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalledWith('migration.import_done');
  });

  it('导入 magic 不匹配 → 错误 toast', async () => {
    mockFileTextResult = JSON.stringify({
      magic: 'wrong',
      preferences: {},
      modeState: { mode: 'standalone', serverUrl: null, initialized: false },
    });
    const { container } = render(<MigrationWizard onClose={() => undefined} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    triggerFileChange(fileInput, makeFile(mockFileTextResult));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockToastError).toHaveBeenCalled();
    expect(mockSetPreferences).not.toHaveBeenCalled();
  });

  it('导入 mode 非法值 → 错误 toast', async () => {
    mockFileTextResult = JSON.stringify({
      magic: 'dustnote-env',
      preferences: {},
      modeState: { mode: 'BAD', serverUrl: null, initialized: false },
    });
    const { container } = render(<MigrationWizard onClose={() => undefined} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    triggerFileChange(fileInput, makeFile(mockFileTextResult));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockToastError).toHaveBeenCalled();
  });

  it('导入 serverUrl 非合法 URL → 错误 toast', async () => {
    mockFileTextResult = JSON.stringify({
      magic: 'dustnote-env',
      preferences: {},
      modeState: { mode: 'online', serverUrl: 'not-a-url', initialized: false },
    });
    const { container } = render(<MigrationWizard onClose={() => undefined} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    triggerFileChange(fileInput, makeFile(mockFileTextResult));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockToastError).toHaveBeenCalled();
  });

  it('导入 JSON 解析失败 → 错误 toast', async () => {
    mockFileTextResult = 'NOT_JSON';
    const { container } = render(<MigrationWizard onClose={() => undefined} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    triggerFileChange(fileInput, makeFile(mockFileTextResult));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockToastError).toHaveBeenCalled();
  });

  it('导入完成时清空 file input.value', async () => {
    mockFileTextResult = JSON.stringify({
      magic: 'dustnote-env',
      preferences: {},
      modeState: { mode: 'standalone', serverUrl: null, initialized: false },
    });
    const { container } = render(<MigrationWizard onClose={() => undefined} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    triggerFileChange(fileInput, makeFile(mockFileTextResult));
    await new Promise((r) => setTimeout(r, 50));
    // 验证 file input value 被清空（防止再次触发）
    expect(fileInput.value).toBe('');
  });
});
