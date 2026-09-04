/**
 * 小程序 WebCrypto 回退：安全随机源
 *
 * 背景：微信小程序运行时（含开发者工具）不提供 Web Crypto API——
 * crypto.subtle / crypto.getRandomValues 均不存在（实测 SDK 3.16.2 亦如此），
 * 只有 wx.getUserCryptoManager().getRandomValues() / wx.getRandomValues()
 * 能生成密码学安全随机数，且是异步 API。
 *
 * 本模块：
 * 1. 启动时用 wx 安全随机 API 预填充一个随机池（异步，容量 1024B）
 * 2. 通过 shared 的 setSecureRandomSource 注入同步取用函数，
 *    使 shared/crypto.ts 的 randomBytes 在无 WebCrypto 环境下也能工作
 * 3. 池剩余不足时后台续池（wx API 单次上限 1024 字节）
 *
 * 必须在应用入口最先引入（app.tsx 顶部），保证任何加密操作前已就绪。
 */

import { setSecureRandomSource } from '@dustnote/shared';

/** wx getRandomValues 单次请求上限 */
const POOL_CAPACITY = 1024;
/** 池剩余低于该阈值时后台续池 */
const REFILL_THRESHOLD = 128;

let pool: Uint8Array = new Uint8Array(POOL_CAPACITY);
let poolPos = POOL_CAPACITY; // 初始为空
let filling = false;

function getWx(): any {
  return (globalThis as any).wx;
}

/** 通过 wx 安全随机 API 异步获取 length 字节 */
function wxFetchRandomBytes(length: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const wx = getWx();
    if (!wx) {
      reject(new Error('wx 不可用，无法获取安全随机数'));
      return;
    }
    const onSuccess = (res: any) => {
      const buf = res && (res.randomValues ?? res.random);
      if (buf) resolve(new Uint8Array(buf));
      else reject(new Error('getRandomValues 未返回数据'));
    };
    const onFail = (err: unknown) => reject(err);
    try {
      // 优先官方推荐 UserCryptoManager，失败回退 wx.getRandomValues
      const mgr = wx.getUserCryptoManager ? wx.getUserCryptoManager() : null;
      if (mgr && typeof mgr.getRandomValues === 'function') {
        mgr.getRandomValues({ length, success: onSuccess, fail: () => fallback() });
      } else {
        fallback();
      }
    } catch {
      fallback();
    }
    function fallback(): void {
      try {
        if (wx.getRandomValues) {
          wx.getRandomValues({ length, success: onSuccess, fail: onFail });
        } else {
          onFail(new Error('当前环境无 wx 安全随机 API'));
        }
      } catch (err) {
        onFail(err);
      }
    }
  });
}

/** 异步续池（保留旧池，失败不影响已有数据） */
async function refillPool(): Promise<void> {
  if (filling) return;
  filling = true;
  try {
    const fresh = await wxFetchRandomBytes(POOL_CAPACITY);
    pool = fresh;
    poolPos = 0;
    poolEverFilled = true;
  } catch {
    /* 保留旧池 */
  } finally {
    filling = false;
  }
}

/** 池是否至少成功填充过一次(真机上 wx 安全随机 API 可用的标志) */
let poolEverFilled = false;

/**
 * 等待安全随机池就绪(供密钥材料生成前调用)。
 * masterKey/盐/shareKey 属长期密钥材料,绝不允许落到时间戳+Math.random
 * 的本地兜底——必须在池就绪后生成。超时抛错而非静默降级。
 * (GCM IV 允许降级:随机池仅保证唯一性要求,由 randomBytes 路径处理。)
 */
export function ensureRandomReady(timeoutMs = 8000): Promise<void> {
  if (poolEverFilled) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (poolEverFilled) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error('安全随机池未就绪(请检查网络/微信版本),已取消密钥操作'));
      }
    }, 100);
  });
}

/** 同步从池中取 n 字节（单次请求不得超过池容量） */
function takeFromPool(n: number): Uint8Array {
  if (n > POOL_CAPACITY) {
    throw new Error('安全随机请求超过单次上限');
  }
  if (poolPos + n > pool.length) {
    // 开发者工具模拟器上 wx 安全随机 API 可能整体不可用（真机可用），
    // 池永远填不上。此时退化为「时间戳+计数器+Math.random」本地兜底：
    // 熵弱于 wx 安全随机，但保证 IV 唯一性（GCM nonce 的硬性要求），
    // 让模拟器上的功能调试可以继续；生产数据以真机安全源为准。
    return localFallbackBytes(n);
  }
  const out = new Uint8Array(n);
  out.set(pool.subarray(poolPos, poolPos + n));
  poolPos += n;
  // 剩余不足时后台续池，避免下次请求耗尽
  if (pool.length - poolPos < REFILL_THRESHOLD) {
    void refillPool();
  }
  return out;
}

let fallbackCounter = 0;
/** 池未就绪时的本地同步兜底：毫秒时间戳(8B) + 递增计数器(4B) + Math.random 补位 */
function localFallbackBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  let v = Date.now();
  for (let i = 0; i < 8 && i < n; i++) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  const c = ++fallbackCounter;
  for (let i = 8; i < 12 && i < n; i++) {
    out[i] = (c >> ((i - 8) * 8)) & 0xff;
  }
  for (let i = 12; i < n; i++) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

// 启动即预填充
void refillPool();

setSecureRandomSource(takeFromPool);

// ========== crypto.getRandomValues 垫片 ==========
// randomBytes 的第一优先路径是 crypto.getRandomValues;若运行时有 crypto
// 对象但缺 getRandomValues(或注入顺序意外失效),在这里补上池化实现,
// 彻底杜绝「无安全随机源」类错误。
const gAny = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
if (!gAny.crypto || typeof gAny.crypto.getRandomValues !== 'function') {
  const base = (gAny.crypto ?? {}) as object;
  gAny.crypto = Object.assign({}, base, {
    getRandomValues: (arr: Uint8Array): Uint8Array => {
      arr.set(takeFromPool(arr.length));
      return arr;
    },
  });
}

// ========== TextEncoder / TextDecoder 垫片 ==========
// 部分真机基础库（如 vivo 低版本）不提供 TextEncoder/TextDecoder，
// 而 shared/crypto 的 UTF-8 编解码依赖它们。开发者工具模拟器有这两个
// 全局对象，因此该问题只在真机暴露。这里补纯 JS UTF-8 实现（无废弃 API）。
class TextEncoderShim {
  readonly encoding = 'utf-8';
  encode(input = ''): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < input.length; i++) {
      const cp = input.codePointAt(i)!;
      if (cp > 0xffff) i++; // 消费代理对
      if (cp <= 0x7f) {
        out.push(cp);
      } else if (cp <= 0x7ff) {
        out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      } else if (cp <= 0xffff) {
        out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 63),
          0x80 | ((cp >> 6) & 63),
          0x80 | (cp & 63),
        );
      }
    }
    return Uint8Array.from(out);
  }
}

class TextDecoderShim {
  decode(input?: ArrayBuffer | Uint8Array): string {
    const b = input instanceof Uint8Array ? input : input ? new Uint8Array(input) : new Uint8Array(0);
    let out = '';
    let i = 0;
    while (i < b.length) {
      const c = b[i]!;
      let cp: number;
      let len: number;
      if (c < 0x80) {
        cp = c;
        len = 1;
      } else if ((c & 0xe0) === 0xc0) {
        cp = c & 0x1f;
        len = 2;
      } else if ((c & 0xf0) === 0xe0) {
        cp = c & 0x0f;
        len = 3;
      } else if ((c & 0xf8) === 0xf0) {
        cp = c & 0x07;
        len = 4;
      } else {
        cp = 0xfffd;
        len = 1;
      }
      if (len > 1) {
        let valid = i + len <= b.length;
        for (let k = 1; valid && k < len; k++) {
          const cb = b[i + k]!;
          if ((cb & 0xc0) !== 0x80) valid = false;
          else cp = (cp << 6) | (cb & 63);
        }
        if (!valid) cp = 0xfffd;
      }
      out += String.fromCodePoint(cp);
      i += len;
    }
    return out;
  }
}

const g = globalThis as Record<string, unknown>;
if (typeof g.TextEncoder === 'undefined') g.TextEncoder = TextEncoderShim;
if (typeof g.TextDecoder === 'undefined') g.TextDecoder = TextDecoderShim;
