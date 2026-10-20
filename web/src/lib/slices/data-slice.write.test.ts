/**
 * shared / client-core 写路径契约测试（用 polyfill）
 *
 * 验 shared 的加密契约 + client-core 的 envelope 序列化：
 *
 * - encryptString / decryptString 往返一致
 * - noteAad(entityId, userId) 派生稳定
 * - 错误 aad / 错误 key 解密抛错（GCM 认证失败）
 * - toBase64Url / fromBase64Url 往返一致
 * - encryptNote / decryptNote envelope 往返一致
 *
 * 前置条件：
 * - Web Crypto 走 node:crypto（polyfills.ts 注入）
 * - 不牵动真实 IDB / fetch / worker
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  encryptString,
  decryptString,
  noteAad,
  toBase64Url,
  fromBase64Url,
} from '@dustnote/shared';
import { installPolyfills } from '../../test/polyfills';

installPolyfills();

// client-core 的 encryptNote / decryptNote 走 CryptoBackend（getCryptoBackend()），
// shared 的默认 backend 已覆盖，直接 import 即可
async function loadClientCore() {
  return import('@dustnote/client-core');
}

describe('shared 加密契约（用 polyfill）', () => {
  const key = randomBytes(32);

  const sampleNote = {
    title: 'Hello',
    content: 'body text',
    tags: ['a', 'b'],
    isPinned: true,
    isFavorite: false,
    folderId: 'f-1',
    deletedAt: null,
  };

  it('encryptString → decryptString 往返一致', async () => {
    const cipher = await encryptString(key, 'secret-payload');
    expect(cipher.c).not.toContain('secret-payload');
    const plain = await decryptString(key, cipher);
    expect(plain).toBe('secret-payload');
  });

  it('加密 JSON 序列化笔记往返一致（envelope 契约）', async () => {
    const aad = noteAad('n-1', 'u-1');
    const cipher = await encryptString(key, JSON.stringify(sampleNote), 1, aad);
    const plain = await decryptString(key, cipher, aad);
    expect(JSON.parse(plain)).toEqual(sampleNote);
  });

  it('noteAad 派生稳定（同 (id,user) → 同 aad）', () => {
    const a1 = noteAad('n-1', 'u-1');
    const a2 = noteAad('n-1', 'u-1');
    expect(Buffer.from(a1).toString('hex')).toBe(Buffer.from(a2).toString('hex'));
    const a3 = noteAad('n-2', 'u-1');
    expect(Buffer.from(a1).toString('hex')).not.toBe(Buffer.from(a3).toString('hex'));
  });

  it('错误 aad 解密抛错（GCM 认证失败）', async () => {
    const aad = noteAad('n-1', 'u-1');
    const cipher = await encryptString(key, 'x', 1, aad);
    const wrongAad = noteAad('n-999', 'u-999');
    await expect(decryptString(key, cipher, wrongAad)).rejects.toThrow();
  });

  it('错误 key 解密抛错', async () => {
    const cipher = await encryptString(key, 'x');
    const wrongKey = randomBytes(32);
    await expect(decryptString(wrongKey, cipher)).rejects.toThrow();
  });

  it('toBase64Url / fromBase64Url 往返一致', () => {
    const bytes = randomBytes(16);
    const encoded = toBase64Url(bytes);
    const decoded = fromBase64Url(encoded);
    expect(Buffer.from(decoded).toString('hex')).toBe(Buffer.from(bytes).toString('hex'));
  });

  it('encryptNote → decryptNote 往返一致（client-core envelope）', async () => {
    const { encryptNote, decryptNote } = await loadClientCore();
    const aad = noteAad('n-1', 'u-1');
    const { envelope } = await encryptNote(key, sampleNote as never, aad);
    const decrypted = await decryptNote(key, envelope, aad);
    expect(decrypted).toEqual(sampleNote);
  });
});
