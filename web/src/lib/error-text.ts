/**
 * 异常 → 面向用户的一句话（web 端胶水）
 *
 * 分流策略在 @dustnote/shared 的 errorReason（含单测）：中文界面原样用服务端
 * 文案（更具体），非中文界面用语义桶文案（避免英文界面里蹦中文）。这里只负责
 * 把当前的 i18next 实例注入进去。
 *
 * 用法：把原先的 `(err as Error).message` 换成 `errorText(err)`。
 */
import { errorReason } from '@dustnote/shared';
import i18n from './i18n';

export function errorText(err: unknown): string {
  return errorReason(err, i18n.language, (key, options) =>
    i18n.t(key, { defaultValue: options?.defaultValue })
  );
}
