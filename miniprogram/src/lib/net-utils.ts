/**
 * 网络地址工具（F9/F14 共用）
 *
 * 内网地址判定：明文 HTTP 只在内网自托管场景可接受，公网明文需要提示
 * （密文与派生凭据可被链路窃听）。
 * weapp 无完整 URL 解析,用正则取 host;IPv6 需先匹配方括号形式。
 */

/** 是否内网地址（localhost / 私有网段 / IPv6 loopback） */
export function isPrivateHost(url: string): boolean {
  // IPv6 方括号形式优先（http://[::1]:3210）
  const v6 = url.match(/^https?:\/\/\[([^\]]+)\]/i);
  if (v6) {
    const addr = v6[1]!.toLowerCase();
    if (addr === '::1' || addr === '0:0:0:0:0:0:0:1') return true;
    if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // ULA
    if (addr.startsWith('fe80')) return true; // link-local
    return false;
  }
  const m = url.match(/^https?:\/\/([^/:?]+)/i);
  if (!m) return false;
  const host = m[1]!.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return true;
  const ip = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ip) return false;
  const a = Number(ip[1]);
  const b = Number(ip[2]);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}
