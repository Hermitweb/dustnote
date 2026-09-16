/**
 * 内网地址判定（技术债清理）
 *
 * 实现已统一到 `@dustnote/shared`（含单测）——此前 miniprogram 与 mobile
 * 各写一份（且 IPv6 分支不可达）,语义漂移会让同一地址在一端警告、另一端
 * 不警告。这里仅再导出并保留本端的历史命名,既有 import 路径不变。
 */
export { isPrivateAddress as isPrivateHost } from '@dustnote/shared';
