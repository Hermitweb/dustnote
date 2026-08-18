/**
 * 密码强度评估
 *
 * 轻量启发式：长度 + 字符种类 + 常见弱密码黑名单。
 * 不做熵估计（zxcvbn 太重），适合在输入时实时反馈。
 *
 * 评分 0~4：
 * - 0 很弱（< 8 字符 或 常见弱密码）
 * - 1 弱（>= 8 字符但只有一种字符种类）
 * - 2 一般（>= 8 字符 + 两种种类）
 * - 3 强（>= 12 字符 + 三种种类）
 * - 4 很强（>= 16 字符 + 四种种类）
 */

export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

const COMMON_WEAK = new Set([
  'password', '12345678', '123456789', '1234567890', 'qwerty123',
  'abc12345', 'password1', 'iloveyou', 'admin123', 'letmein1',
  '11111111', '00000000', 'dustnote1', 'dustnote123',
]);

export function evalPasswordStrength(pw: string): PasswordStrength {
  if (!pw) return 0;
  if (pw.length < 8 || COMMON_WEAK.has(pw.toLowerCase())) return 0;

  let kinds = 0;
  if (/[a-z]/.test(pw)) kinds++;
  if (/[A-Z]/.test(pw)) kinds++;
  if (/[0-9]/.test(pw)) kinds++;
  if (/[^a-zA-Z0-9]/.test(pw)) kinds++;

  if (pw.length >= 16 && kinds >= 4) return 4;
  if (pw.length >= 12 && kinds >= 3) return 3;
  if (kinds >= 2) return 2;
  return 1;
}

export const STRENGTH_LABELS: Record<PasswordStrength, string> = {
  0: 'password.strength_very_weak',
  1: 'password.strength_weak',
  2: 'password.strength_fair',
  3: 'password.strength_strong',
  4: 'password.strength_very_strong',
};

export const STRENGTH_COLORS: Record<PasswordStrength, string> = {
  0: 'bg-red-500',
  1: 'bg-red-400',
  2: 'bg-amber-400',
  3: 'bg-emerald-500',
  4: 'bg-emerald-600',
};
