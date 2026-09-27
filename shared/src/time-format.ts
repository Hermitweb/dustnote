/**
 * 笔记时间戳的统一格式（阶段 2.7 · 与 DOC-003 同源）
 *
 * 改造前三端各写一套：web 用 Intl.DateTimeFormat（中文 "10:43"、英文 "10:43 AM"），
 * 小程序直接 toLocaleString('zh-CN') 写死中文并把秒也带上，移动端又是一套。
 * 同一篇笔记在三端显示成三个样子，用户没法确认"这是不是刚才那篇"。
 *
 * 规则以 web 现有的为准（当天只看时刻，本年看月日，跨年才带年份），三端共用一份实现：
 *   当天 → "HH:mm"    本年 → "M/D"    跨年 → "YYYY/M/D"
 *
 * 为什么不用 Intl：小程序运行时没有 Intl。用了就注定"三端三种样子"，
 * 而这正是这个文件存在的理由。代价是英文用户不再看到 "10:43 AM" ——
 * 跨端一致比单端本地化更重要，24 小时制在笔记列表里也不歧义。
 */

function parts(d: Date): { hh: string; mm: string; sameDay: boolean; sameYear: boolean } {
  const now = new Date();
  return {
    hh: String(d.getHours()).padStart(2, '0'),
    mm: String(d.getMinutes()).padStart(2, '0'),
    sameDay: d.toDateString() === now.toDateString(),
    sameYear: d.getFullYear() === now.getFullYear(),
  };
}

/** 笔记列表用：无效时间返回空串，调用方可直接渲染不必判空 */
export function formatNoteStamp(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = parts(d);
  if (p.sameDay) return `${p.hh}:${p.mm}`;
  if (p.sameYear) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 完整时间戳（设备最后活跃、分享创建/到期、历史版本）。
 * 这些场合"是哪一天"比"几点几分"更重要，所以永远带年份。
 */
export function formatDateTimeStamp(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = parts(d);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p.hh}:${p.mm}`;
}
