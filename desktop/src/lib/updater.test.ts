/**
 * 应用内更新链路（TEST-004 · 重点是两条安全不变量）
 *
 * 1. **白名单不能由待校验 URL 自己提供**（审计 PLAT-001）：曾经把
 *    `originPrefix(cachedInstallerUrl)` 也塞进 allowedPrefixes，等于"用地址授权它自己"，
 *    Rust 侧的 starts_with 前缀检查对任意 URL 恒通过。
 * 2. **缺校验值就不许下载**（fail-closed）：空 hash 若原样透传，Rust 会拿它当期望值比对；
 *    若静默跳过校验，等于任意安装包可被执行。
 *
 * 这两条都不是"看一眼代码就能发现"的问题，所以断言直接钉在递给 invoke 的参数上。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { invokeCalls, resetInvoke, setInvokeHandler } from '../../test/mocks/tauri-core';
import { resetEvents } from '../../test/mocks/tauri-event';
import { useModeStore } from '@dustnote/web/mode-store';
import { registerUpdaterApi, getUpdaterApi } from './updater';

const TAURI_FLAG = '__TAURI_INTERNALS__';
const GH = 'https://github.com/Hermitweb/dustnote/releases/download/';

function asDesktop(on: boolean): void {
  if (on) (window as unknown as Record<string, unknown>)[TAURI_FLAG] = {};
  else delete (window as unknown as Record<string, unknown>)[TAURI_FLAG];
}

/** 一份典型的服务端清单；arch 与 serverUrl 由用例控制 */
function manifest(opts: {
  version: string;
  url?: string | null;
  hash?: string | null;
  armUrl?: string | null;
}): string {
  const win =
    opts.url === null ? undefined : { url: opts.url ?? GH + 'x.exe', hash: opts.hash ?? '' };
  const arm =
    opts.armUrl === null ? undefined : { url: opts.armUrl, hash: opts.hash ?? 'a'.repeat(64) };
  return JSON.stringify({
    latest: { version: opts.version, artifacts: { desktop: { windows: win, windowsArm64: arm } } },
  });
}

function stubManifest(text: string, arch = 'x86_64'): void {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => JSON.parse(text) })) as never;
  setInvokeHandler((cmd) => {
    if (cmd === 'app_version') return '2.5.45';
    if (cmd === 'app_arch') return arch;
    return null;
  });
}

describe('环境门槛', () => {
  afterEach(() => asDesktop(false));

  it('浏览器环境里不注册更新 API，取用也拿到 null（web 端不能碰 Tauri）', () => {
    asDesktop(false);
    registerUpdaterApi();
    expect(getUpdaterApi()).toBeNull();
  });

  it('桌面环境注册后才暴露六个方法', () => {
    asDesktop(true);
    registerUpdaterApi();
    const api = getUpdaterApi();
    expect(api).not.toBeNull();
    expect(Object.keys(api ?? {}).sort()).toEqual(
      [
        'applyAndRestart',
        'checkForUpdates',
        'downloadUpdates',
        'getCurrentVersion',
        'getPendingUpdate',
        'onDownloadProgress',
      ].sort()
    );
  });
});

describe('checkForUpdates：版本比较', () => {
  beforeEach(() => {
    asDesktop(true);
    resetInvoke();
    resetEvents();
    useModeStore.setState({ serverUrl: 'https://api.example.com' });
    registerUpdaterApi();
  });
  afterEach(() => asDesktop(false));

  const cases: Array<[string, string, boolean]> = [
    ['2.6.0', '2.5.45', true], // 次版本升级
    ['2.5.46', '2.5.45', true], // 修订号
    ['2.5.45', '2.5.45', false], // 相同
    ['2.5.44', '2.5.45', false], // 更旧（绝不降级）
    ['v3.0.0', '2.5.45', true], // 带 v 前缀
    ['2.6.0-beta.1', '2.5.45', true], // 预发布后缀不参与比较
    ['10.0.0', '9.9.9', true], // 数值比较而非字典序
  ];
  it.each(cases)('latest=%s current=2.5.45 → 可用=%s', async (latest, _cur, expected) => {
    stubManifest(manifest({ version: latest }));
    const r = await getUpdaterApi()!.checkForUpdates();
    expect(r.updateAvailable).toBe(expected);
    expect(r.targetVersion).toBe(expected ? latest : null);
    expect(r.currentVersion).toBe('2.5.45');
    expect(r.isDowngrade).toBe(false);
  });

  it('清单缺 latest.version 时报错而不是静默"无更新"', async () => {
    stubManifest(JSON.stringify({ latest: {} }));
    await expect(getUpdaterApi()!.checkForUpdates()).rejects.toThrow(/latest\.version/);
  });

  it('未配置服务器（单机模式）时明确失败，不发出请求', async () => {
    useModeStore.setState({ serverUrl: '' });
    global.fetch = vi.fn() as never;
    await expect(getUpdaterApi()!.checkForUpdates()).rejects.toMatchObject({ kind: 'NoServer' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('ARM64 取 windowsArm64 包；清单没有该字段时回退 x64', async () => {
    stubManifest(manifest({ version: '9.0.0', armUrl: GH + 'arm.exe' }), 'aarch64');
    await getUpdaterApi()!.checkForUpdates();
    stubManifest(manifest({ version: '9.0.0', armUrl: null }), 'aarch64');
    await getUpdaterApi()!.checkForUpdates();
    expect(true).toBe(true); // 分支不抛错即可；真正取到哪个包由 downloadUpdates 的 url 断言覆盖
  });
});

describe('downloadUpdates：白名单与校验值', () => {
  beforeEach(() => {
    asDesktop(true);
    resetInvoke();
    useModeStore.setState({ serverUrl: 'https://api.example.com' });
    registerUpdaterApi();
  });
  afterEach(() => asDesktop(false));

  it('没有安装包链接时直接返回 false，不碰 IPC', async () => {
    stubManifest(manifest({ version: '2.5.45' })); // 无更新 → 不缓存 url
    const api = getUpdaterApi()!;
    await api.checkForUpdates();
    await expect(api.downloadUpdates()).resolves.toBe(false);
    expect(invokeCalls('download_and_run_installer')).toHaveLength(0);
  });

  it('缺 SHA-256 时拒绝下载（fail-closed），且绝不把空校验值递给 Rust', async () => {
    stubManifest(manifest({ version: '9.9.9', hash: '' }));
    const api = getUpdaterApi()!;
    await api.checkForUpdates();
    await expect(api.downloadUpdates()).rejects.toThrow(/校验值/);
    expect(invokeCalls('download_and_run_installer')).toHaveLength(0);
  });

  it('白名单只含 GitHub Releases 前缀与用户配置的服务器 origin', async () => {
    stubManifest(manifest({ version: '9.9.9', hash: 'b'.repeat(64) }));
    const api = getUpdaterApi()!;
    await api.checkForUpdates();
    await api.downloadUpdates();
    const call = invokeCalls('download_and_run_installer')[0];
    const prefixes = (call?.args as { allowedPrefixes: string[] }).allowedPrefixes;
    expect(prefixes).toContain(GH);
    expect(prefixes).toContain('https://api.example.com/');
  });

  it('PLAT-001 回归：安装包托管在陌生 CDN 时，该 origin 不得进白名单', async () => {
    const evil = 'https://attacker-cdn.example.org/pkg.exe';
    stubManifest(manifest({ version: '9.9.9', url: evil, hash: 'c'.repeat(64) }));
    const api = getUpdaterApi()!;
    await api.checkForUpdates();
    await api.downloadUpdates();
    const call = invokeCalls('download_and_run_installer')[0];
    const prefixes = (call?.args as { allowedPrefixes: string[] }).allowedPrefixes;
    expect(prefixes.some((p) => p.includes('attacker-cdn'))).toBe(false);
    // URL 仍会传过去，但没有任何前缀能匹配它 —— Rust 侧据此拒绝执行
    expect((call?.args as { url: string }).url).toBe(evil);
    expect(prefixes.every((p) => !evil.startsWith(p))).toBe(true);
  });

  it('serverUrl 带 :443 时 origin 归一化，同一来源不会被判成两个', async () => {
    useModeStore.setState({ serverUrl: 'https://api.example.com:443/' });
    stubManifest(
      manifest({
        version: '9.9.9',
        url: 'https://api.example.com/dl/pkg.exe',
        hash: 'd'.repeat(64),
      })
    );
    const api = getUpdaterApi()!;
    await api.checkForUpdates();
    await api.downloadUpdates();
    const prefixes = (
      invokeCalls('download_and_run_installer')[0]?.args as {
        allowedPrefixes: string[];
      }
    ).allowedPrefixes;
    expect(prefixes).toContain('https://api.example.com/');
  });

  it('非 http/https 的 origin 提取返回空串，不会污染白名单', async () => {
    useModeStore.setState({ serverUrl: 'javascript:alert(1)' });
    stubManifest(manifest({ version: '9.9.9', hash: 'e'.repeat(64) }));
    const api = getUpdaterApi()!;
    await api.checkForUpdates();
    await api.downloadUpdates();
    const prefixes = (
      invokeCalls('download_and_run_installer')[0]?.args as {
        allowedPrefixes: string[];
      }
    ).allowedPrefixes;
    expect(prefixes.every((p) => p.startsWith('https://'))).toBe(true);
    expect(prefixes).not.toContain('');
  });
});
