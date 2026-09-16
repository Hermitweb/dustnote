/**
 * 内网地址判定单测（技术债清理：该逻辑此前散落在 mobile/miniprogram 各一份,
 * 且零测试覆盖——语义漂移会导致同一地址在一端警告、另一端不警告）
 */
import { describe, it, expect } from 'vitest';
import { isPrivateAddress } from '../src/net-utils.js';

describe('isPrivateAddress', () => {
  it('recognizes loopback hosts', () => {
    expect(isPrivateAddress('http://localhost:3210')).toBe(true);
    expect(isPrivateAddress('https://localhost')).toBe(true);
    expect(isPrivateAddress('http://127.0.0.1:8080')).toBe(true);
    expect(isPrivateAddress('http://127.1.2.3')).toBe(true); // 127/8 整段
    expect(isPrivateAddress('http://[::1]:3210')).toBe(true);
  });

  it('recognizes RFC1918 private ranges', () => {
    expect(isPrivateAddress('http://10.0.0.5')).toBe(true);
    expect(isPrivateAddress('http://172.16.0.1')).toBe(true);
    expect(isPrivateAddress('http://172.31.255.254')).toBe(true);
    expect(isPrivateAddress('http://192.168.1.100:8080')).toBe(true);
  });

  it('recognizes IPv6 ULA / link-local', () => {
    expect(isPrivateAddress('http://[fd00::1]')).toBe(true);
    expect(isPrivateAddress('http://[fe80::1]:8080')).toBe(true);
  });

  it('treats public addresses as non-private', () => {
    expect(isPrivateAddress('http://8.8.8.8')).toBe(false);
    expect(isPrivateAddress('https://napi.iniess.cn')).toBe(false);
    expect(isPrivateAddress('http://172.32.0.1')).toBe(false); // 172.32 不在 /12 内
    expect(isPrivateAddress('http://11.0.0.1')).toBe(false);
    expect(isPrivateAddress('http://[2001:db8::1]')).toBe(false); // 文档用公网段
  });

  it('returns false for malformed / non-http inputs (fail-open to warning)', () => {
    expect(isPrivateAddress('')).toBe(false);
    expect(isPrivateAddress('not a url')).toBe(false);
    expect(isPrivateAddress('ftp://10.0.0.1')).toBe(false);
  });
});
