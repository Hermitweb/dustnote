/**
 * Argon2id Worker 客户端
 *
 * 将 deriveSecrets 卸载到 Web Worker，主线程不再阻塞。
 * 支持 Worker 不可用时回退到主线程执行（兼容旧浏览器 / 非 secure context）。
 */

import { deriveSecrets, KDF_PARAMS, type KdfParams, type DerivedSecrets } from '@dustnote/shared';

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (v: DerivedSecrets) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./argon2-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, result, error } = e.data as {
        id: number;
        result?: { kek: number[]; authKey: number[] };
        error?: string;
      };
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) {
        p.reject(new Error(error));
      } else if (result) {
        p.resolve({ kek: new Uint8Array(result.kek), authKey: new Uint8Array(result.authKey) });
      }
    };
    worker.onerror = (e) => {
      // Worker 加载失败：清空引用，后续调用走 fallback
      console.warn('[argon2-worker] Worker error, falling back to main thread:', e.message);
      worker = null;
      // reject 所有 pending
      for (const [id, p] of pending) {
        p.reject(new Error('Worker failed'));
        pending.delete(id);
      }
    };
    return worker;
  } catch {
    // Worker 构造失败（如 CSP 限制）
    return null;
  }
}

/**
 * 在 Worker 中执行 deriveSecrets。Worker 不可用时回退到主线程。
 *
 * @param secret 主密码或恢复码
 * @param salt 盐（Uint8Array）
 * @param params KDF 参数（默认 Argon2id）
 */
export async function deriveSecretsInWorker(
  secret: string,
  salt: Uint8Array,
  params: KdfParams = KDF_PARAMS
): Promise<DerivedSecrets> {
  const w = getWorker();
  if (!w) {
    // Worker 不可用：回退到主线程
    return deriveSecrets(secret, salt, params);
  }

  const id = nextId++;
  return new Promise<DerivedSecrets>((resolve, reject) => {
    // 30 秒超时（Argon2id 正常 1-3 秒，极端情况 10 秒）
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Argon2id Worker timeout'));
    }, 30_000);

    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });

    w.postMessage({
      id,
      secret,
      salt: Array.from(salt),
      params,
    });
  });
}
