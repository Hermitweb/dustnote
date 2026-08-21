import { describe, it, expect } from 'vitest';
import { encryptNote, decryptNote, parseEnvelope, ENVELOPE_VERSION } from '../src/envelope.js';
import type { CryptoBackend } from '../src/crypto-backend.js';
import type { Ciphertext } from '@dustnote/shared';

/**
 * 注入一个确定性 mock CryptoBackend，避免触碰真实的 WebCrypto / Argon2：
 * - encryptString：把明文 base64 当密文，记录是否传了 AAD
 * - decryptString：反向还原；AAD 标记必须匹配
 * 这样测试快、稳、不依赖运行时 crypto。
 */
function mockBackend(): CryptoBackend {
  const enc = (s: string): string => btoa(unescape(encodeURIComponent(s)));
  const dec = (s: string): string => decodeURIComponent(escape(atob(s)));
  return {
    randomBytes: (n: number) => {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = i & 0xff;
      return b;
    },
    encryptString: async (
      _key: Uint8Array,
      plaintext: string,
      keyVersion = 1,
      aad?: Uint8Array
    ): Promise<Ciphertext> => {
      return {
        v: 1,
        k: keyVersion,
        n: enc('nonce'),
        c: enc(plaintext),
        a: aad ? 1 : 0,
      };
    },
    decryptString: async (
      _key: Uint8Array,
      blob: Ciphertext,
      aad?: Uint8Array
    ): Promise<string> => {
      const needsAad = blob.a === 1;
      if (needsAad && !aad) throw new Error('decryption failed');
      if (!needsAad && aad) throw new Error('decryption failed');
      return dec(blob.c);
    },
    noteAad: (entityId: string, userId: string) =>
      new TextEncoder().encode(`${entityId}||${userId}`),
  };
}

describe('envelope', () => {
  const key = new Uint8Array(32);
  const pt = { title: '你好', content: '世界\nnewline', tags: ['a', 'b'] };
  const backend = mockBackend();

  it('encrypt → decrypt roundtrip with AAD', async () => {
    const aad = backend.noteAad('note-1', 'user-1');
    const { envelope, json } = await encryptNote(key, pt, aad, backend);
    expect(envelope.v).toBe(ENVELOPE_VERSION);
    expect(envelope.payload.a).toBe(1);
    expect(typeof json).toBe('string');
    const back = await decryptNote(key, envelope, aad, backend);
    expect(back).toEqual(pt);
  });

  it('encrypt without AAD → payload.a === 0, decrypt without AAD', async () => {
    const { envelope } = await encryptNote(key, pt, undefined, backend);
    expect(envelope.payload.a).toBe(0);
    const back = await decryptNote(key, envelope, undefined, backend);
    expect(back).toEqual(pt);
  });

  it('AAD mismatch: encrypted with AAD but decrypted without → throws', async () => {
    const aad = backend.noteAad('note-1', 'user-1');
    const { envelope } = await encryptNote(key, pt, aad, backend);
    await expect(decryptNote(key, envelope, undefined, backend)).rejects.toThrow();
  });

  it('legacy no-AAD blob decrypted with AAD passed → succeeds (aad stripped, needed for loadAll)', async () => {
    // 旧密文（a=0）无 AAD 绑定。loadAll 对所有笔记都传 noteAad，包括旧笔记；
    // decryptNote 必须为旧密文剥除 AAD 才能解密，否则旧笔记全部解密失败。
    const { envelope } = await encryptNote(key, pt, undefined, backend);
    expect(envelope.payload.a).toBe(0);
    const aad = backend.noteAad('note-1', 'user-1');
    const back = await decryptNote(key, envelope, aad, backend);
    expect(back).toEqual(pt);
  });

  it('version mismatch → throws', async () => {
    const { envelope } = await encryptNote(key, pt, undefined, backend);
    envelope.v = 999;
    await expect(decryptNote(key, envelope, undefined, backend)).rejects.toThrow(
      /envelope version mismatch/
    );
  });

  it('parseEnvelope: new envelope format', () => {
    const raw = JSON.stringify({ v: 1, payload: { v: 1, k: 1, n: 'n', c: 'c' } });
    const env = parseEnvelope(raw);
    expect(env.v).toBe(1);
    expect(env.payload.c).toBe('c');
  });

  it('parseEnvelope: legacy Ciphertext format (wrapped into envelope)', () => {
    const raw = JSON.stringify({ v: 1, k: 1, n: 'n', c: 'c' });
    const env = parseEnvelope(raw);
    expect(env.v).toBe(ENVELOPE_VERSION);
    expect(env.payload.c).toBe('c');
  });

  it('parseEnvelope: invalid → throws', () => {
    expect(() => parseEnvelope(JSON.stringify({ foo: 'bar' }))).toThrow(/invalid envelope/);
    expect(() => parseEnvelope('not json')).toThrow();
  });
});
