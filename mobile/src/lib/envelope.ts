/**
 * 笔记加密信封 — mobile 统一入口（v2.5.5 迁移到 @dustnote/client-core）
 *
 * 旧实现把 parseEnvelope / decryptNote / packEnvelope 分散复制在
 * NotesListScreen / NoteEditScreen / SharesScreen / TrashScreen /
 * migration.ts 六个文件里，且 packEnvelope 未绑定 AAD，与 web 不一致。
 *
 * 本模块是 mobile 端的信封单一真相源，全部委托给 client-core：
 * - parseEnvelope(raw)            → client-core parseEnvelope（签名一致）
 * - decryptNote(key, raw, aad?)   → client-core decryptNote（兼容旧"传密文字符串"签名）
 * - packEnvelope(key, plain, aad?) → client-core encryptNote，返回可入库 JSON 字符串
 *
 * 各 screen 只需从本模块导入，删除各自本地定义。
 */

import {
  parseEnvelope as coreParseEnvelope,
  decryptNote as coreDecryptNote,
  encryptNote as coreEncryptNote,
  type NoteCipherEnvelope,
} from '@dustnote/client-core';
import type { NotePlaintext } from '@dustnote/shared';

/** 解析密文信封（兼容新 {v,payload} 与旧 Ciphertext 格式） */
export function parseEnvelope(raw: string): NoteCipherEnvelope {
  return coreParseEnvelope(raw);
}

/**
 * 解密一条笔记。
 *
 * @param ciphertext 服务端存的密文 JSON 字符串（内部先 parseEnvelope）
 * @param aad 可选 AAD（noteId||userId）；新密文（a===1）必须传
 */
export async function decryptNote(
  key: Uint8Array,
  ciphertext: string,
  aad?: Uint8Array
): Promise<NotePlaintext> {
  const envelope = coreParseEnvelope(ciphertext);
  return coreDecryptNote(key, envelope, aad);
}

/**
 * 把明文打包成密文信封 JSON 字符串（用于 createNote / updateNote 的 ciphertext 字段）。
 *
 * @param aad 可选 AAD（noteId||userId）。传了则密文绑定 AAD（防重排，与 web 一致）。
 */
export async function packEnvelope(
  key: Uint8Array,
  plain: NotePlaintext,
  aad?: Uint8Array
): Promise<string> {
  const { json } = await coreEncryptNote(key, plain, aad);
  return json;
}

export type { NoteCipherEnvelope };
