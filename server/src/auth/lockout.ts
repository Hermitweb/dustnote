/**
 * 账号级密码错误锁定
 *
 * 策略（与 roadmap §M1 一致）：
 * - 连续 6 次密码错误 → 锁定该账号 15 分钟
 * - 锁定期间即使密码正确也拒绝登录
 * - 登录成功立即清零计数
 *
 * 这层是「账号级」锁定，与 app.ts 中「IP 级」express-rate-limit 互补：
 * - IP 限流：防止同一 IP 对多账号的分布式爆破
 * - 账号锁定：防止同一账号被定向爆破（即使攻击者换 IP）
 *
 * 纯函数设计：所有函数接收 state + 可选 now，返回新 state，
 * 不直接操作 DB，便于单元测试。auth 路由负责读写 DB 列
 * (failed_attempts / locked_until)。
 */

export const MAX_FAILED_ATTEMPTS = 6;
export const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 分钟

/** 账号锁定状态（对应 users 表的两列） */
export interface LockoutState {
  failedAttempts: number;
  /** 锁定截止时间（ISO 字符串），null = 未锁定 */
  lockedUntil: string | null;
}

/** 初始状态（新账号或成功登录后） */
export const CLEAN_STATE: LockoutState = { failedAttempts: 0, lockedUntil: null };

/**
 * 当前是否处于锁定状态。
 * now 参数允许测试注入时间；生产代码用默认 new Date()。
 */
export function isLocked(state: LockoutState, now: Date = new Date()): boolean {
  if (!state.lockedUntil) return false;
  return new Date(state.lockedUntil).getTime() > now.getTime();
}

/** 距离解锁还有多少毫秒（未锁定返回 0） */
export function remainingLockMs(state: LockoutState, now: Date = new Date()): number {
  if (!state.lockedUntil) return 0;
  return Math.max(0, new Date(state.lockedUntil).getTime() - now.getTime());
}

/**
 * 记录一次失败登录，返回新的 state。
 * - 累计失败次数
 * - 达到 MAX_FAILED_ATTEMPTS 时设置 lockedUntil = now + LOCK_DURATION_MS
 * - 已锁定状态下再次失败：保持锁定，刷新 lockedUntil（延长窗口）
 */
export function recordFailure(state: LockoutState, now: Date = new Date()): LockoutState {
  const attempts = state.failedAttempts + 1;
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    return {
      failedAttempts: attempts,
      lockedUntil: new Date(now.getTime() + LOCK_DURATION_MS).toISOString(),
    };
  }
  return { failedAttempts: attempts, lockedUntil: null };
}

/** 登录成功后重置状态 */
export function recordSuccess(): LockoutState {
  return { ...CLEAN_STATE };
}
