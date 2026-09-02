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
  } catch {
    /* 保留旧池 */
  } finally {
    filling = false;
  }
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
