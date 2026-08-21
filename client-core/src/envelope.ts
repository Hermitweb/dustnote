/**
 * 笔记加密信封（从 web/src/lib/store.ts 抽取，四端共享）
 *
 * 服务端只存整个 envelope 的 JSON 字符串，客户端用 masterKey 解 payload
 * 得到 NotePlaintext。本模块是「信封格式」的单一真相源：
 * - web/store.ts 原有的 encryptNote/decryptNote/parseEnvelope 迁移至此
 * - mobile / miniprogram 不再各自重写，直接复用
 * - 通过 CryptoBackend 注入平台加密后端，与具体 crypto 实现解耦
 */

import type { Ciphertext, NotePlaintext } from '@dustnote/shared';
import { getCryptoBackend, type CryptoBackend } from './crypto-backend.js';

/** 信封版本 */
export const ENVELOPE_VERSION = 1;

/**
 * 笔记密文信封：服务端只存这整个对象（JSON 序列化后存 DB）。
 *
 * payload 是 AES-GCM Ciphertext（v/k/n/c/a），明文 = JSON.stringify(NotePlaintext)。
 */
export interface NoteCipherEnvelope {
  /** 信封版本 */
  v: number;
  /** 加密后的明文 blob（包含 title/content/tags） */
  payload: Ciphertext;
}

/**
 * 加密一条笔记明文，返回信封对象与可入库的 JSON 字符串。
 *
 * @param key  masterKey
 * @param pt   明文
 * @param aad  可选 AAD（noteId||userId），绑定后防密文重排；模板/旧数据不传
 * @param backend 可注入的加密后端，默认取全局 active backend
 */
export async function encryptNote(
  key: Uint8Array,
  pt: NotePlaintext,
  aad?: Uint8Array,
  backend: CryptoBackend = getCryptoBackend()
): Promise<{ envelope: NoteCipherEnvelope; json: string }> {
  const json = JSON.stringify(pt);
  // AAD 绑定 noteId||userId（§2.2）：防重排攻击；模板/旧数据不传（密文保持 a=0 向后兼容）
  const blob = await backend.encryptString(key, json, 1, aad);
  const envelope: NoteCipherEnvelope = { v: ENVELOPE_VERSION, payload: blob };
  return { envelope, json: JSON.stringify(envelope) };
}

/**
 * 解密笔记信封，返回明文。
 *
 * 历史密文（payload.a !== 1）无 AAD 绑定，解密时不传；新密文（a === 1）
 * 必须传相同 AAD，否则 AES-GCM 认证失败。
 */
export async function decryptNote(
  key: Uint8Array,
  envelope: NoteCipherEnvelope,
  aad?: Uint8Array,
  backend: CryptoBackend = getCryptoBackend()
): Promise<NotePlaintext> {
  if (envelope.v !== ENVELOPE_VERSION) {
    throw new Error(`envelope version mismatch: ${envelope.v}`);
  }
  const needsAad = envelope.payload.a === 1;
  if (needsAad && !aad) {
    throw new Error('decryptNote: 此密文绑定了 AAD，但解密时未提供 AAD');
  }
  const json = await backend.decryptString(
    key,
    envelope.payload,
    needsAad ? aad : undefined
  );
  return JSON.parse(json) as NotePlaintext;
}

/**
 * 把服务端存的 ciphertext 字符串解析成信封对象。
 *
 * 兼容两种历史格式：
 * - 新格式：{ v, payload } 信封
 * - 旧格式：直接是 Ciphertext（{ v, k, n, c }），包装成信封返回
 */
export function parseEnvelope(raw: string): NoteCipherEnvelope {
  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'v' in parsed &&
    'payload' in parsed
  ) {
    return parsed as NoteCipherEnvelope;
  }
  // 旧格式：直接是 Ciphertext
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'c' in parsed &&
    'n' in parsed
  ) {
    return { v: ENVELOPE_VERSION, payload: parsed as Ciphertext };
  }
  throw new Error('invalid envelope');
}
