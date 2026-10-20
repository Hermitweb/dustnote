/**
 * shared/net-utils.ts 单测 —— 内网地址识别
 *
 * 跨端单一实现：mobile / miniprogram / web 都要靠它判断是否需要「明文 HTTP 警告」。
 * 测试覆盖 IPv4 私网段、localhost、IPv6 各种写法、公网地址返回 false。
 */
import { describe, it, expect } from 'vitest';
import { isPrivateAddress } from './net-utils.js';

describe('isPrivateAddress', () => {
  describe('IPv4', () => {
    it.each([
      'http://localhost',
      'http://localhost:3210',
      'http://LOCALHOST:3210',
      'http://127.0.0.1',
      'http://127.0.0.1:8080',
      'http://127.255.255.254', // 整段回环
    ])('内网：%s → true', (url) => {
      expect(isPrivateAddress(url)).toBe(true);
    });

    it.each([
      'http://10.0.0.1',
      'http://10.255.255.255',
      'http://172.16.0.1',
      'http://172.20.10.5',
      'http://172.31.255.254',
      'http://192.168.1.1',
      'http://192.168.255.255',
    ])('私网段：%s → true', (url) => {
      expect(isPrivateAddress(url)).toBe(true);
    });

    it.each([
      'http://172.15.0.1', // 172.16 之前
      'http://172.32.0.1', // 172.32 之后
      'http://11.0.0.1',
      'http://192.169.0.1', // 192.168 之外
    ])('公网段：%s → false', (url) => {
      expect(isPrivateAddress(url)).toBe(false);
    });
  });

  describe('IPv6', () => {
    it.each([
      'http://[::1]',
      'http://[::1]:3210',
      'http://[0:0:0:0:0:0:0:1]',
      'http://[fc00::1]', // ULA
      'http://[fd12:3456::1]', // ULA
      'http://[fe80::1]', // link-local
    ])('内网：%s → true', (url) => {
      expect(isPrivateAddress(url)).toBe(true);
    });

    it.each([
      'http://[2001:db8::1]', // 公网
      'http://[2606:4700:4700::1111]', // 公网
    ])('公网：%s → false', (url) => {
      expect(isPrivateAddress(url)).toBe(false);
    });
  });

  describe('hostname（非 IP）', () => {
    it.each(['http://example.com', 'https://dustnote.app', 'http://my-server.local:3210'])(
      '公网域名：%s → false',
      (url) => {
        expect(isPrivateAddress(url)).toBe(false);
      }
    );
  });

  describe('非法输入', () => {
    it('非 http 协议 → false（防误判）', () => {
      expect(isPrivateAddress('ftp://127.0.0.1')).toBe(false);
    });
    it('完全无 host → false', () => {
      expect(isPrivateAddress('not-a-url')).toBe(false);
    });
  });
});
