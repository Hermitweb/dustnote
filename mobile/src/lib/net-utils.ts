/**
 * 网络地址工具（M16/F9 共用）
 *
 * 内网地址判定：明文 HTTP 只在内网自托管场景可接受，公网明文需要提示
 * （密文与派生凭据可被链路窃听）。
 * 与小程序端 `miniprogram/src/lib/net-utils.ts` 保持同一判定语义
 * （含 IPv6 方括号形式与 ULA/link-local 段）——两端漂移会导致同址不同判。
 */

/** 是否内网地址（localhost / 私有网段 / IPv6 loopback / ULA / link-local） */
export function isPrivateAddress(url: string): boolean {
  // IPv6 方括号形式优先（http://[::1]:3210）——new URL 的 hostname 会带方括号
  const v6 = url.match(/^https?:\/\/\[([^\]]+)\]/i);
  if (v6) {
    const addr = v6[1]!.toLowerCase();
    if (addr === '::1' || addr === '0:0:0:0:0:0:0:1') return true;
    if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // ULA
    if (addr.startsWith('fe80')) return true; // link-local
    return false;
  }
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  } catch {
    return false;
  }
}
