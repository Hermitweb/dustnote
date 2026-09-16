/**
 * 内网地址判定（技术债清理）
 *
 * 实现已统一到 `@dustnote/shared`（含单测）——此前 mobile 与 miniprogram
 * 各写一份,语义漂移会让同一地址在一端警告、另一端不警告。
 * 这里仅再导出，保持既有 import 路径不变。
 */
export { isPrivateAddress } from '@dustnote/shared';
