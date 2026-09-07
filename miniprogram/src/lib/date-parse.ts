/**
 * 服务端时间字符串的安全解析
 *
 * 服务端 SQLite DEFAULT (datetime('now')) 产出的「YYYY-MM-DD HH:MM:SS」
 * (空格分隔)在 iOS/JSC 的 new Date() 下得到 Invalid Date（JSC 只认
 * 「YYYY/MM/DD HH:MM:SS」或 ISO 的 T 分隔）。解析前统一把空格归一化为
 * ISO 的 T 分隔。也能容错 Date/number 输入，便于各页面直接替换 new Date(...)。
 */
export function parseServerDate(v: string | number | Date | null | undefined): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  if (!v) return new Date(NaN);
  // SQLite datetime 串只有一个空格分隔符，替换成 T 即成为合法 ISO 串
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(v)) return new Date(v.replace(' ', 'T'));
  return new Date(v);
}
