/**
 * SemVer 工具（轻量实现，避免引入 semver 包）
 * 支持：^x.y.z 解析、比较、排序、强制更新判断
 */

/** 解析 semver 字符串 */
export function parseSemver(version: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
} | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+[a-zA-Z0-9.-]+)?$/.exec(version);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
    prerelease: match[4] ? match[4] : null,
  };
}

/** 比较两个 semver：a < b 返回负数，a === b 返回 0，a > b 返回正数 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`Invalid semver: ${!pa ? a : b}`);

  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;

  // 预发布版本 < 正式版本
  if (pa.prerelease && !pb.prerelease) return -1;
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && pb.prerelease) {
    return pa.prerelease.localeCompare(pb.prerelease);
  }
  return 0;
}

/** a < b */
export function lt(a: string, b: string): boolean {
  return compareSemver(a, b) < 0;
}

/** a > b */
export function gt(a: string, b: string): boolean {
  return compareSemver(a, b) > 0;
}

/** a === b */
export function eq(a: string, b: string): boolean {
  return compareSemver(a, b) === 0;
}

/** a <= b */
export function lte(a: string, b: string): boolean {
  return compareSemver(a, b) <= 0;
}

/** 强制更新判断 */
export type ForceUpdateLevel = 'L0_block' | 'L1_2nd_startup' | 'L2_strong_prompt' | 'L3_soft_prompt' | null;

export interface ForceUpdateParams {
  current: string;
  min: string;
  recommended: string;
  force: string | null;
  releaseDate?: string; // ISO date，14d 后 L2 强提示
}

/** 距今天数 */
function daysSince(iso?: string): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86400000);
}

export function shouldForceUpdate(p: ForceUpdateParams): ForceUpdateLevel {
  if (p.force && lt(p.current, p.force)) return 'L0_block';
  if (lt(p.current, p.min)) return 'L1_2nd_startup';
  if (lt(p.current, p.recommended) && daysSince(p.releaseDate) > 14) return 'L2_strong_prompt';
  return null;
}
