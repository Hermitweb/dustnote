import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('my-share-password');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);

    expect(await verifyPassword('my-share-password', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('my-share-password');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('produces different hashes for the same password', async () => {
    const hash1 = await hashPassword('same-password');
    const hash2 = await hashPassword('same-password');
    expect(hash1).not.toBe(hash2);
  });

  it('rejects malformed stored hash', async () => {
    expect(await verifyPassword('pwd', 'not-valid-base64!!!')).toBe(false);
    expect(await verifyPassword('pwd', '')).toBe(false);
  });
});
