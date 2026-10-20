/**
 * server/src/services/update-manifest.ts 单测 —— Update Manifest 服务层
 *
 * 覆盖：CHANNEL_VERSIONS（环境变量覆盖）、BETA_TRAFFIC_RATIO 切流、pickChannelForDevice
 * 灰度稳定切分、getManifestForChannel 输出、artifactFor（存在/不存在/缓存命中）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;
let prevDownloadsDir: string | undefined;

vi.mock('../env.js', () => ({
  config: {
    serverVersion: '2.99.0',
    webOrigin: 'https://example.com',
    forceUpdateVersion: null,
    minClientVersion: '2.0.0',
    recommendedClientVersion: '2.5.0',
    eolDateForV0: undefined,
  },
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));

// 模块只经 loadModule() 动态加载（DOWNLOADS_DIR 需在 beforeEach 里设好后再求值）

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'upd-'));
  prevDownloadsDir = process.env.DOWNLOADS_DIR;
  process.env.DOWNLOADS_DIR = tmpDir;
  // 清除模块缓存以重置 hashCache
  vi.resetModules();
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  if (prevDownloadsDir === undefined) delete process.env.DOWNLOADS_DIR;
  else process.env.DOWNLOADS_DIR = prevDownloadsDir;
  vi.resetModules();
});

/** 重新加载模块（用当前 env + mock） */
async function loadModule() {
  // env.js mock 在第一次 import 时已生效；DOWNLOADS_DIR 变化需要重置模块
  return import('./update-manifest.js');
}

describe('update-manifest', () => {
  describe('通道版本（间接验证：stable 用真实 serverVersion，其它取自 CHANNEL_VERSIONS）', () => {
    it('channel=stable 时 latest.version 等于 serverVersion', async () => {
      const m = await loadModule();
      const out = m.getManifestForChannel('stable', {
        clientVersion: '2.0.0',
        platform: 'web',
        deviceId: 'd',
      });
      expect(out.latest.version).toBe('2.99.0');
    });

    it('channel=nightly 时 latest.version 是 nightly.* 格式', async () => {
      const m = await loadModule();
      const out = m.getManifestForChannel('nightly', {
        clientVersion: '2.0.0',
        platform: 'web',
        deviceId: 'd',
      });
      expect(out.latest.version).toMatch(/^0\.1\.0-nightly\./);
    });
  });

  describe('getManifestForChannel（基础输出）', () => {
    it('channel=stable + 无 beta 配置 → 100% 走 stable', async () => {
      const m = await loadModule();
      const out = m.getManifestForChannel('stable', {
        clientVersion: '2.0.0',
        platform: 'desktop',
        deviceId: 'dev-1',
      });
      expect(out.channel).toBe('stable');
      expect(out.latest.version).toBe('2.99.0');
      expect(out.latest.minServerVersion).toBe('2.99.0');
      expect(out.serverVersion).toBe('2.99.0');
      expect(out.latest.changelogUrl).toContain('v2.99.0');
    });

    it('mandatory=false（无 forceUpdateVersion）', async () => {
      const m = await loadModule();
      const out = m.getManifestForChannel('stable', {
        clientVersion: '2.0.0',
        platform: 'web',
        deviceId: 'd',
      });
      expect(out.latest.mandatory).toBe(false);
    });

    it('强制升级线存在 + 通道版本 >= force → mandatory=true', async () => {
      vi.doMock('../env.js', () => ({
        config: {
          serverVersion: '2.99.0',
          webOrigin: 'https://example.com',
          forceUpdateVersion: '2.0.0',
          minClientVersion: '2.0.0',
          recommendedClientVersion: '2.5.0',
          eolDateForV0: undefined,
        },
      }));
      const m = await import('./update-manifest.js');
      const out = m.getManifestForChannel('stable', {
        clientVersion: '2.0.0',
        platform: 'web',
        deviceId: 'd',
      });
      expect(out.latest.mandatory).toBe(true);
    });

    it('通道版本 < force → mandatory=false', async () => {
      vi.doMock('../env.js', () => ({
        config: {
          serverVersion: '2.99.0',
          webOrigin: 'https://example.com',
          forceUpdateVersion: '9.9.9',
          minClientVersion: '2.0.0',
          recommendedClientVersion: '2.5.0',
          eolDateForV0: undefined,
        },
      }));
      const m = await import('./update-manifest.js');
      const out = m.getManifestForChannel('stable', {
        clientVersion: '2.0.0',
        platform: 'web',
        deviceId: 'd',
      });
      expect(out.latest.mandatory).toBe(false);
    });

    it('maintenance 字段始终为 null', async () => {
      const m = await loadModule();
      const out = m.getManifestForChannel('stable', {
        clientVersion: '2.0.0',
        platform: 'web',
        deviceId: 'd',
      });
      expect(out.maintenance).toBeNull();
    });
  });

  describe('pickChannelForDevice 灰度切流', () => {
    it('requested=nightly → 始终 nightly（不受 BETA_TRAFFIC_RATIO 影响）', async () => {
      process.env.BETA_TRAFFIC_RATIO = '1';
      process.env.UPDATE_CHANNEL_BETA = '1.0.0';
      const m = await loadModule();
      const out = m.getManifestForChannel('nightly', {
        clientVersion: '2.0.0',
        platform: 'web',
        deviceId: 'any',
      });
      expect(out.channel).toBe('nightly');
    });

    it('BETA 未配置 → 100% stable 切流（即使 BETA_TRAFFIC_RATIO=1）', async () => {
      process.env.BETA_TRAFFIC_RATIO = '1';
      delete process.env.UPDATE_CHANNEL_BETA;
      const m = await loadModule();
      // 多 deviceId 都应走 stable
      for (const id of ['a', 'b', 'c', 'd', 'e']) {
        const out = m.getManifestForChannel('stable', {
          clientVersion: '2.0.0',
          platform: 'web',
          deviceId: id,
        });
        expect(out.channel).toBe('stable');
      }
    });

    it('BETA_TRAFFIC_RATIO=1 + BETA 配置 → 100% 切到 beta', async () => {
      process.env.BETA_TRAFFIC_RATIO = '1';
      process.env.UPDATE_CHANNEL_BETA = '1.0.0';
      const m = await loadModule();
      for (const id of ['a', 'b', 'c', 'd', 'e']) {
        const out = m.getManifestForChannel('stable', {
          clientVersion: '2.0.0',
          platform: 'web',
          deviceId: id,
        });
        expect(out.channel).toBe('beta');
      }
    });

    it('BETA_TRAFFIC_RATIO=0 → 100% stable', async () => {
      process.env.BETA_TRAFFIC_RATIO = '0';
      process.env.UPDATE_CHANNEL_BETA = '1.0.0';
      const m = await loadModule();
      for (const id of ['a', 'b', 'c', 'd', 'e']) {
        const out = m.getManifestForChannel('stable', {
          clientVersion: '2.0.0',
          platform: 'web',
          deviceId: id,
        });
        expect(out.channel).toBe('stable');
      }
    });

    it('BETA_TRAFFIC_RATIO=0.5 → 约一半 deviceId 切 beta（统计抽样）', async () => {
      process.env.BETA_TRAFFIC_RATIO = '0.5';
      process.env.UPDATE_CHANNEL_BETA = '1.0.0';
      const m = await loadModule();
      let betaCount = 0;
      const N = 200;
      for (let i = 0; i < N; i++) {
        const out = m.getManifestForChannel('stable', {
          clientVersion: '2.0.0',
          platform: 'web',
          deviceId: `dev-${i}`,
        });
        if (out.channel === 'beta') betaCount++;
      }
      // 期望 50% 左右，允许 ±15% 误差
      expect(betaCount).toBeGreaterThan(N * 0.35);
      expect(betaCount).toBeLessThan(N * 0.65);
    });

    it('同一 deviceId 多次调用 → 切流结果稳定', async () => {
      process.env.BETA_TRAFFIC_RATIO = '0.5';
      process.env.UPDATE_CHANNEL_BETA = '1.0.0';
      const m = await loadModule();
      const a1 = m.getManifestForChannel('stable', {
        clientVersion: '2.0.0',
        platform: 'web',
        deviceId: 'stable-id',
      });
      const a2 = m.getManifestForChannel('stable', {
        clientVersion: '2.0.0',
        platform: 'web',
        deviceId: 'stable-id',
      });
      const a3 = m.getManifestForChannel('stable', {
        clientVersion: '2.0.0',
        platform: 'web',
        deviceId: 'stable-id',
      });
      expect(a1.channel).toBe(a2.channel);
      expect(a2.channel).toBe(a3.channel);
    });
  });

  describe('artifacts 字段', () => {
    it('DOWNLOADS_DIR 全部缺失 → artifacts 各 artifact 为 undefined（不报非法值）', async () => {
      const m = await loadModule();
      const out = m.getManifestForChannel('stable', {
        clientVersion: '2.0.0',
        platform: 'desktop',
        deviceId: 'd',
      });
      expect(out.latest.artifacts.desktop.windows).toBeUndefined();
      expect(out.latest.artifacts.desktop.windowsArm64).toBeUndefined();
      expect(out.latest.artifacts.android.apk).toBeUndefined();
    });

    it('存在文件 → url/hash/size 正确，hash 形如 sha256:<64hex>', async () => {
      const filename = `DustNote_2.99.0_x64-setup.exe`;
      const content = Buffer.from('fake installer bytes for hash test');
      writeFileSync(join(tmpDir, filename), content);
      const m = await loadModule();
      const out = m.getManifestForChannel('stable', {
        clientVersion: '2.0.0',
        platform: 'desktop',
        deviceId: 'd',
      });
      const a = out.latest.artifacts.desktop.windows!;
      expect(a).toBeDefined();
      expect(a.url).toBe(`https://example.com/downloads/${filename}`);
      expect(a.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(a.size).toBe(content.length);
    });

    it('hash 缓存：同文件二次访问复用计算（不报错）', async () => {
      const filename = `DustNote_2.99.0_android.apk`;
      writeFileSync(join(tmpDir, filename), 'android content');
      const m = await loadModule();
      const a1 = m.getManifestForChannel('stable', {
        clientVersion: '2.0.0',
        platform: 'android',
        deviceId: 'd',
      });
      const a2 = m.getManifestForChannel('stable', {
        clientVersion: '2.0.0',
        platform: 'android',
        deviceId: 'd',
      });
      expect(a1.latest.artifacts.android.apk?.hash).toBe(a2.latest.artifacts.android.apk?.hash);
    });
  });
});
