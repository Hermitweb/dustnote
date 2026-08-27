/**
 * Argon2id Web Worker
 *
 * 将 CPU 密集的 Argon2id 密钥派生移到 Worker 线程，
 * 避免解锁时阻塞主线程 1-3 秒。
 *
 * 消息协议：
 * - 输入：{ id, secret, salt, params? }
 * - 输出：{ id, result: { kek, authKey } } | { id, error }
 */

import { deriveSecrets, KDF_PARAMS, type KdfParams } from '@dustnote/shared';

interface WorkerRequest {
  id: number;
  secret: string;
  salt: number[];
  params?: KdfParams;
}

interface WorkerResponse {
  id: number;
  result?: { kek: number[]; authKey: number[] };
  error?: string;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, secret, salt, params } = e.data;
  try {
    const saltArr = new Uint8Array(salt);
    const result = await deriveSecrets(secret, saltArr, params ?? KDF_PARAMS);
    const response: WorkerResponse = {
      id,
      result: {
        kek: Array.from(result.kek),
        authKey: Array.from(result.authKey),
      },
    };
    self.postMessage(response);
  } catch (err) {
    const response: WorkerResponse = {
      id,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
