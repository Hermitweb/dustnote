import { describe, it, expect } from 'vitest';
import {
  deriveMasterKey,
  deriveRecoveryKey,
  encrypt,
  decrypt,
  encryptString,
  decryptString,
  wrapMasterKey,
  unwrapMasterKey,
  isCiphertext,
} from '../src/crypto';

describe('crypto', () => {
  const password = 'correct-horse-battery-staple';
  const salt = crypto.getRandomValues(new Uint8Array(16));

  it('derives the same master key from the same password and salt', async () => {
    const mk1 = await deriveMasterKey(password, salt);
    const mk2 = await deriveMasterKey(password, salt);
    expect(mk1).toEqual(mk2);
    expect(mk1.length).toBe(32);
  });

  it('derives different keys for different passwords', async () => {
    const mk1 = await deriveMasterKey(password, salt);
    const mk2 = await deriveMasterKey('another-password', salt);
    expect(mk1).not.toEqual(mk2);
  });

  it('encrypts and decrypts bytes', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = new TextEncoder().encode('hello dustnote');
    const blob = await encrypt(key, plaintext);
    expect(blob.v).toBe(1);
    expect(blob.k).toBe(1);
    expect(typeof blob.n).toBe('string');
    expect(typeof blob.c).toBe('string');

    const decrypted = await decrypt(key, blob);
    expect(new TextDecoder().decode(decrypted)).toBe('hello dustnote');
  });

  it('encrypts and decrypts strings', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const blob = await encryptString(key, '尘心笔记');
    const decrypted = await decryptString(key, blob);
    expect(decrypted).toBe('尘心笔记');
  });

  it('wraps and unwraps master key with recovery key', async () => {
    const masterKey = crypto.getRandomValues(new Uint8Array(32));
    const recoveryKey = await deriveRecoveryKey(password, salt);
    const wrapped = await wrapMasterKey(recoveryKey, masterKey);
    expect(isCiphertext(wrapped)).toBe(true);

    const unwrapped = await unwrapMasterKey(recoveryKey, wrapped);
    expect(unwrapped).toEqual(masterKey);
  });

  it('fails to unwrap with wrong recovery key', async () => {
    const masterKey = crypto.getRandomValues(new Uint8Array(32));
    const recoveryKey = await deriveRecoveryKey(password, salt);
    const wrongKey = await deriveRecoveryKey('wrong-password', salt);
    const wrapped = await wrapMasterKey(recoveryKey, masterKey);
    await expect(unwrapMasterKey(wrongKey, wrapped)).rejects.toThrow();
  });

  it('detects invalid ciphertext shape', () => {
    expect(isCiphertext({ v: 1, k: 1, n: 'abc', c: 'def' })).toBe(true);
    expect(isCiphertext({ v: 1, k: 1, n: 'abc' })).toBe(false);
    expect(isCiphertext(null)).toBe(false);
    expect(isCiphertext('string')).toBe(false);
  });
});
