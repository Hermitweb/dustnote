/**
 * 网络地址工具（跨端单一实现）
 *
 * 用途：判定「明文 HTTP 是否只作用于内网自托管场景」——公网明文链路上
 * 密文与派生凭据可被窃听,各端据此提示用户。
 *
 * 为什么放在 shared：同一判定曾在 mobile 与 miniprogram 各写一份,语义漂移
 * 会导致同一地址在两端得到不同结论（一端警告一端不警告）。此处为唯一实现。
 * 实现刻意用正则而非 `new URL`：小程序运行时（weapp）没有完整 URL 解析。
 */

/** 是否为内网地址（localhost / 私有网段 / IPv6 loopback / ULA / link-local） */
export function isPrivateAddress(url: string): boolean {
  // IPv6 方括号形式优先（http://[::1]:3210）
  const v6 = url.match(/^https?:\/\/\[([^\]]+)\]/i);
  if (v6) {
    const addr = v6[1]!.toLowerCase();
    if (addr === '::1' || addr === '0:0:0:0:0:0:0:1') return true;
    if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // ULA
    if (addr.startsWith('fe80')) return true; // link-local
    return false;
  }

  // 裸 IPv6（无方括号,如 http://::1/）——解析正则取到 '::1' 前缀即可判定
  const bare6 = url.match(/^https?:\/\/([0-9a-f:]{2,})/i);
  if (bare6 && bare6[1]!.includes(':')) {
    const addr = bare6[1]!.toLowerCase();
    if (addr.startsWith('::1') || addr.startsWith('fc') || addr.startsWith('fd') || addr.startsWith('fe80')) {
      return true;
    }
  }

  const m = url.match(/^https?:\/\/([^/:?]+)/i);
  if (!m) return false;
  const host = m[1]!.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return true;

  const ip = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ip) return false;
  const a = Number(ip[1]);
  const b = Number(ip[2]);
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 127) return true; // 127.0.0.0/8（本机回环整段）
  return false;
}
