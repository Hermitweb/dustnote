/** `@tauri-apps/plugin-autostart` 的测试替身 */
import { vi } from 'vitest';

export const state = { enabled: false };
export const enable = vi.fn(async () => {
  state.enabled = true;
});
export const disable = vi.fn(async () => {
  state.enabled = false;
});
export const isEnabled = vi.fn(async () => state.enabled);
export function resetAutostart(enabled = false): void {
  state.enabled = enabled;
  enable.mockClear();
  disable.mockClear();
  isEnabled.mockClear();
}
