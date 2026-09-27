/**
 * `@tauri-apps/api/core` 的测试替身
 *
 * 只替 IPC 这一条边界：`invoke` 的实现由每个用例通过 `setInvokeHandler` 注入，
 * 其余（updater 的状态机、白名单计算、超时保护）全部跑真身。
 */
import { vi } from 'vitest';

type Handler = (cmd: string, args?: Record<string, unknown>) => unknown;

let handler: Handler = () => null;
/** 记录每次 invoke 的 (cmd, args)，用于断言"到底有没有把危险参数递给 Rust" */
export const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];

export function setInvokeHandler(h: Handler): void {
  handler = h;
}

export function invokeCalls(cmd?: string): Array<{ cmd: string; args?: Record<string, unknown> }> {
  return cmd ? calls.filter((c) => c.cmd === cmd) : calls;
}

export const invoke = vi.fn(
  async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
    calls.push({ cmd, args });
    return handler(cmd, args);
  }
);

export function resetInvoke(): void {
  calls.length = 0;
  handler = () => null;
  invoke.mockClear();
}
