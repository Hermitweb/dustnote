/**
 * 异常 → 面向用户的一句话（小程序端胶水）
 *
 * 分流策略在 @dustnote/shared 的 errorReason（含单测）：中文界面原样用服务端
 * 文案（更具体），非中文界面用语义桶文案（避免英文界面里蹦中文）。
 *
 * 小程序用的是自研 t()（无 defaultValue 参数），所以这里在键缺失时（t 返回 key
 * 本身）自行回退 defaultValue——即服务端文案，作为词典漏配时的最后防线。
 *
 * 用法：把原先的 `err?.message` 换成 `errorText(err)`。
 */
import { errorReason } from '@dustnote/shared';
import { getLanguage, t } from './i18n';

export function errorText(err: unknown): string {
  return errorReason(err, getLanguage(), (key, options) => {
    const localized = t(key);
    if (localized !== key) return localized;
    return options?.defaultValue ?? key;
  });
}
