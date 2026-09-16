/**
 * 网络地址工具（M16/F9 共用）
 *
 * 内网地址判定：明文 HTTP 只在内网自托管场景可接受，公网明文需要提示
 * （密文与派生凭据可被链路窃听）。
 */

/** 是否内网地址（localhost / 私有网段 / IPv6 loopback） */
export function isPrivateAddress(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
      return true;
    }
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
