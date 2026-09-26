/** `@tauri-apps/plugin-notification` 的测试替身 */
import { vi } from 'vitest';

export const requestPermission = vi.fn(async () => 'granted' as const);
export const isPermissionGranted = vi.fn(() => true);
export const sendNotification = vi.fn((_opts: unknown) => undefined);
export function resetNotification(): void {
  requestPermission.mockClear();
  isPermissionGranted.mockClear();
  sendNotification.mockClear();
}
