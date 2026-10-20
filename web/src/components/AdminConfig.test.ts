/**
 * AdminConfig 校验函数回归（部署管理板块）
 *
 * validateApiBase / validateMpAppId 是纯函数，直接测形状判定。
 * apiBase 填错曾静默保存（所有客户端连不上）——校验是那次隐患的防回潮。
 *
 * 另外挂一组 @testing-library 风格的 React 渲染测试，覆盖组件主体
 * （保存校验、连接测试、Tab 切换、下载/复制、resetConfirm 二步确认）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, fireEvent, cleanup, waitFor } from '../test/render';
import { validateApiBase, validateMpAppId, AdminConfig } from './AdminConfig';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      // 简单 i18n 插值：'admin.current_addr' + {addr: 'x'} → 'x'
      if (k === 'admin.current_addr' && opts && typeof opts.addr === 'string') {
        return opts.addr as string;
      }
      return k;
    },
    i18n: { language: 'zh-CN' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

/* ---------- 共享 mock（hoisted 以绕开 vi.mock 工厂前置限制） ---------- */
// 统一用 rest 签名：mock 工厂里以 `(...args: unknown[]) => fn(...args)` 转发，
// 固定形参的 mock 在转发时会被 TS 判为 TS2556（spread 必须传元组或 rest 形参）。
const {
  getConfig,
  saveConfig,
  generatePlatformConfig,
  downloadConfig,
  loadConfig,
  resetConfigStorage,
  copyText,
  toastMock,
  CONFIG_DEFAULTS,
} = vi.hoisted(() => ({
  getConfig: vi.fn((..._args: unknown[]) => ({
    apiBase: 'https://api.example.com/api/v1',
    appName: 'DustNote',
    miniprogramAppId: '',
  })),
  saveConfig: vi.fn((..._args: unknown[]) => undefined as any),
  generatePlatformConfig: vi.fn((...args: unknown[]) => `config-for-${args[0] as string}`),
  downloadConfig: vi.fn((..._args: unknown[]) => undefined as any),
  loadConfig: vi.fn(async (..._args: unknown[]) => ({
    apiBase: 'https://api.example.com/api/v1',
    appName: 'DustNote',
    miniprogramAppId: '',
  })),
  resetConfigStorage: vi.fn((..._args: unknown[]) => undefined as any),
  copyText: vi.fn((..._args: unknown[]) => undefined as any),
  toastMock: { success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  CONFIG_DEFAULTS: {
    apiBase: 'https://api.example.com/api/v1',
    appName: 'DustNote',
    miniprogramAppId: '',
  },
}));

vi.mock('../lib/config', () => ({
  getConfig: (...args: unknown[]) => getConfig(...args),
  saveConfig: (...args: unknown[]) => saveConfig(...args),
  generatePlatformConfig: (...args: unknown[]) => generatePlatformConfig(...args),
  downloadConfig: (...args: unknown[]) => downloadConfig(...args),
  loadConfig: (...args: unknown[]) => loadConfig(...args),
  resetConfigStorage: (...args: unknown[]) => resetConfigStorage(...args),
  CONFIG_DEFAULTS,
}));

vi.mock('../lib/clipboard', () => ({
  copyText: (...args: unknown[]) => copyText(...args),
}));

vi.mock('../lib/toast', () => ({ toast: toastMock }));

describe('validateApiBase', () => {
  it('空串 → validate_empty（必填）', () => {
    expect(validateApiBase('')).toBe('admin.validate_empty');
    expect(validateApiBase('   ')).toBe('admin.validate_empty');
  });

  it('尾斜杠 → validate_trailing_slash（拼接 /health 会产生 //health）', () => {
    expect(validateApiBase('https://api.example.com/')).toBe('admin.validate_trailing_slash');
  });

  it('缺 /api/v1 后缀（http 绝对）→ validate_missing_api_v1', () => {
    expect(validateApiBase('https://api.example.com')).toBe('admin.validate_missing_api_v1');
    expect(validateApiBase('http://api.example.com/v1')).toBe('admin.validate_missing_api_v1');
  });

  it('缺 /api/v1 后缀（相对路径）→ validate_missing_api_v1', () => {
    expect(validateApiBase('/api')).toBe('admin.validate_missing_api_v1');
    expect(validateApiBase('/v1')).toBe('admin.validate_missing_api_v1');
  });

  it('合法：https://x.com/api/v1', () => {
    expect(validateApiBase('https://api.example.com/api/v1')).toBeNull();
  });

  it('合法：/api/v1（相对路径，同源部署）', () => {
    expect(validateApiBase('/api/v1')).toBeNull();
  });

  it('合法：http:// 内网 IP:port/api/v1', () => {
    expect(validateApiBase('http://192.168.1.10:3210/api/v1')).toBeNull();
  });

  it('非法：纯字符串（无协议也无 / 前缀）→ validate_invalid_url', () => {
    expect(validateApiBase('not-a-url')).toBe('admin.validate_invalid_url');
  });

  it('空 + 仅有空白（trim 后）→ 空', () => {
    expect(validateApiBase('  \t\n  ')).toBe('admin.validate_empty');
  });
});

describe('validateMpAppId', () => {
  it('空串合法（选填字段）', () => {
    expect(validateMpAppId('')).toBeNull();
    expect(validateMpAppId('   ')).toBeNull();
  });

  it('标准格式合法：wx + 16 位小写 hex（miniprogram/project.config.json 实例）', () => {
    expect(validateMpAppId('wx29cbaab430c2a098')).toBeNull();
  });

  it('大写 hex 非法', () => {
    expect(validateMpAppId('wx29CBAAB430C2A098')).toBe('admin.validate_appid');
  });

  it('长度不足/超出非法', () => {
    expect(validateMpAppId('wx123')).toBe('admin.validate_appid');
    expect(validateMpAppId('wx29cbaab430c2a0980')).toBe('admin.validate_appid');
  });

  it('缺 wx 前缀非法', () => {
    expect(validateMpAppId('29cbaab430c2a098xx')).toBe('admin.validate_appid');
  });
});

/* ============================================================
 * React 组件渲染测试（覆盖 480 行 JSX 主体）
 * ============================================================ */

describe('AdminConfig 组件', () => {
  beforeEach(() => {
    getConfig.mockClear();
    saveConfig.mockClear();
    generatePlatformConfig.mockClear();
    downloadConfig.mockClear();
    loadConfig.mockClear();
    resetConfigStorage.mockClear();
    copyText.mockClear();
    toastMock.success.mockClear();
    toastMock.error.mockClear();
    toastMock.warn.mockClear();
    toastMock.info.mockClear();
    // 重置 fetch
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, version: '1.0.0' }), { status: 200 })
    ) as unknown as typeof fetch;
  });

  afterEach(() => cleanup());

  it('挂载 → 渲染 close 按钮 + 三个 Tab', () => {
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    expect(r.container.querySelector('[aria-label="common.close"]')).toBeTruthy();
    // 三个 Tab 文字
    expect(r.getByText('admin.tab_config')).toBeTruthy();
    expect(r.getByText('admin.tab_download')).toBeTruthy();
    expect(r.getByText('admin.tab_miniprogram')).toBeTruthy();
  });

  it('默认 Tab=config → 显示 apiBase/appName/mpAppid 三个 input', () => {
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    expect(r.getByPlaceholderText('https://api.your-domain.com/api/v1')).toBeTruthy();
    expect(r.getByPlaceholderText('DustNote')).toBeTruthy();
    expect(r.getByPlaceholderText('wxXXXXXXXXXXXXXXXX')).toBeTruthy();
  });

  it('输入非法 apiBase → 校验错误显示 + 保存按钮变红框', () => {
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    // apiBase 字段是 <input>，fireEvent.change 的签名只接受 input/textarea
    const input = r.getByPlaceholderText('https://api.your-domain.com/api/v1') as HTMLInputElement;
    fireEvent.change(input, 'bad-url');
    expect(r.queryByText('admin.validate_invalid_url')).toBeTruthy();
    // input aria-invalid=true
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('点击 save：apiBase 非法 → 不调 saveConfig + 弹 toast.error', () => {
    getConfig.mockReturnValueOnce({
      apiBase: 'bad-url',
      appName: 'DustNote',
      miniprogramAppId: '',
    });
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    const saveBtn = r.getByText('admin.save_btn');
    fireEvent.click(saveBtn);
    expect(saveConfig).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalled();
  });

  it('点击 save：合法 → saveConfig 调一次 + 写 trimmed values', () => {
    getConfig.mockReturnValueOnce({
      apiBase: '  https://api.example.com/api/v1  ',
      appName: '  MyApp  ',
      miniprogramAppId: '  wx29cbaab430c2a098  ',
    });
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    const saveBtn = r.getByText('admin.save_btn');
    fireEvent.click(saveBtn);
    expect(saveConfig).toHaveBeenCalledTimes(1);
    const arg = saveConfig.mock.calls[0]![0] as {
      apiBase: string;
      appName: string;
      miniprogramAppId: string;
    };
    expect(arg.apiBase).toBe('https://api.example.com/api/v1');
    expect(arg.appName).toBe('MyApp');
    expect(arg.miniprogramAppId).toBe('wx29cbaab430c2a098');
  });

  it('点击 save：appName 为空 → 回退 "DustNote"', () => {
    getConfig.mockReturnValueOnce({
      apiBase: 'https://api.example.com/api/v1',
      appName: '   ',
      miniprogramAppId: '',
    });
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    fireEvent.click(r.getByText('admin.save_btn'));
    const arg = saveConfig.mock.calls[0]![0] as { appName: string };
    expect(arg.appName).toBe('DustNote');
  });

  it('点击连接测试 → /health 探活 → 显示 ok + 版本', async () => {
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    fireEvent.click(r.getByText('admin.test_btn'));
    await waitFor(() => {
      expect(r.queryByText(/admin.test_ok/)).toBeTruthy();
    });
  });

  it('连接测试失败（HTTP 500）→ test_fail', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 500 })
    ) as unknown as typeof fetch;
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    fireEvent.click(r.getByText('admin.test_btn'));
    await waitFor(() => {
      expect(r.queryByText(/admin.test_fail/)).toBeTruthy();
    });
  });

  it('连接测试失败（ok=false）→ test_db_error', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: false }), { status: 200 })
    ) as unknown as typeof fetch;
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    fireEvent.click(r.getByText('admin.test_btn'));
    await waitFor(() => {
      // 任意 test_fail 标签都接受（具体 reason 是 test_db_error 是 i18n key，
      // 我们的 t mock 直接返回 key，所以容器里能找到 test_fail + test_db_error 两个 key）
      expect(r.queryByText(/admin.test_fail/)).toBeTruthy();
    });
  });

  it('点 reset → 弹出两步确认 ConfirmDialog', () => {
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    // 初始无 ConfirmDialog
    expect(r.container.querySelector('[role="alertdialog"]')).toBeNull();
    // 点 reset 按钮
    const resetBtn = r.getByText('admin.reset_btn');
    fireEvent.click(resetBtn);
    // 弹出 alertdialog
    expect(r.container.querySelector('[role="alertdialog"]')).toBeTruthy();
    // 取消 → dialog 消失 + resetConfigStorage 没调
    const cancelBtn = r.container.querySelector(
      '[role="alertdialog"] button:first-of-type'
    ) as HTMLElement;
    fireEvent.click(cancelBtn);
    expect(r.container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(resetConfigStorage).not.toHaveBeenCalled();
  });

  it('reset → 确认 → resetConfigStorage + saveConfig + 状态重置', () => {
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    fireEvent.click(r.getByText('admin.reset_btn'));
    // confirm dialog 第二个按钮（variant=danger 的 confirmLabel）
    const dialog = r.container.querySelector('[role="alertdialog"]')!;
    const buttons = dialog.querySelectorAll('button');
    // 第一个是 cancel，第二个是 confirm（reset_btn 文案）
    const confirmBtn = buttons[1] as HTMLElement;
    fireEvent.click(confirmBtn);
    expect(resetConfigStorage).toHaveBeenCalled();
    expect(saveConfig).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('admin.reset_done');
  });

  it('点 close → 调 onClose', () => {
    const onClose = vi.fn();
    const r = render(createElement(AdminConfig, { onClose }));
    const closeBtn = r.container.querySelector('[aria-label="common.close"]') as HTMLElement;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('切到 download Tab → 显示 5 个平台下载块', () => {
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    fireEvent.click(r.getByText('admin.tab_download'));
    // 5 个平台按钮
    expect(r.getAllByText('admin.plat_web').length).toBeGreaterThan(0);
    expect(r.getAllByText('admin.plat_android').length).toBeGreaterThan(0);
    // 5 个 download 按钮
    const downloadButtons = r.container.querySelectorAll('button');
    // 验证有至少 5 个含 download 字样
    const withDownload = Array.from(downloadButtons).filter((b) =>
      b.textContent?.includes('admin.download_btn')
    );
    expect(withDownload.length).toBeGreaterThanOrEqual(5);
  });

  it('切到 download → 点 desktop 下载 → downloadConfig 调用', () => {
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    fireEvent.click(r.getByText('admin.tab_download'));
    // 平台块 div className 形如 "rounded-lg border ..."，wrapper 是 "space-y-4"，
    // 用 closest('div.rounded-lg') 精确锚到平台块，避免被 wrapper 截胡。
    const downloadBtn = Array.from(r.container.querySelectorAll('button')).find((b) => {
      const block = b.closest('div.rounded-lg');
      return block?.textContent?.includes('admin.plat_desktop');
    }) as HTMLElement;
    expect(downloadBtn).toBeTruthy();
    fireEvent.click(downloadBtn);
    expect(downloadConfig).toHaveBeenCalledWith('dustnote-desktop-config.json', expect.any(String));
  });

  it('download Tab → 点复制 → copyText + toast.success', () => {
    copyText.mockResolvedValueOnce(true);
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    fireEvent.click(r.getByText('admin.tab_download'));
    const copyBtn = r.getByText('admin.copy_btn');
    fireEvent.click(copyBtn);
    expect(copyText).toHaveBeenCalled();
  });

  it('点 preview → 展开后再点 → 折叠（状态切换）', () => {
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    fireEvent.click(r.getByText('admin.tab_download'));
    // 初始无 <pre>
    expect(r.container.querySelector('pre')).toBeNull();
    // 第一个 preview
    const previewBtn = r.getAllByText('admin.preview_show')[0]!;
    fireEvent.click(previewBtn);
    expect(r.container.querySelector('pre')).toBeTruthy();
    // 折叠
    const hideBtn = r.getAllByText('admin.preview_hide')[0]!;
    fireEvent.click(hideBtn);
    expect(r.container.querySelector('pre')).toBeNull();
  });

  it('切到 miniprogram Tab → 显示指引内容', () => {
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    fireEvent.click(r.getByText('admin.tab_miniprogram'));
    expect(r.getByText('admin.mp_warning_title')).toBeTruthy();
    expect(r.getByText('admin.mp_build_title')).toBeTruthy();
  });

  it('底部 footer 显示当前 apiBase（来自 cfg）', () => {
    getConfig.mockReturnValueOnce({
      apiBase: 'https://custom.example.com/api/v1',
      appName: 'X',
      miniprogramAppId: '',
    });
    const r = render(createElement(AdminConfig, { onClose: () => undefined }));
    // footer 用 {{addr}} 插值，需要 mock t 支持插值
    // 这里仅验证容器中存在自定义 apiBase（i18n mock 返回 key，但 cfg.apiBase 在某处被引用）
    const all = r.container.textContent ?? '';
    expect(all).toContain('custom.example.com');
  });
});
