/**
 * react-native-keychain 内存桩：按 service 分格。
 * ACCESS_CONTROL / ACCESSIBLE 常量供 auth.ts 引用（值为占位串，不参与逻辑）。
 */
interface Credentials {
  username: string;
  password: string;
  service: string;
}

const store = new Map<string, Credentials>();

export const ACCESS_CONTROL = {
  BIOMETRY_CURRENT_SET: 'BIOMETRY_CURRENT_SET',
  DEVICE_PASSCODE: 'DEVICE_PASSCODE',
} as const;

export const ACCESSIBLE = {
  WHEN_UNLOCKED: 'AccessibleWhenUnlocked',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
} as const;

export async function setGenericPassword(
  username: string,
  password: string,
  options?: { service?: string }
): Promise<{ service: string; storage: string }> {
  const service = options?.service ?? 'default';
  store.set(service, { username, password, service });
  return { service, storage: 'keychain' };
}

export async function getGenericPassword(options?: {
  service?: string;
}): Promise<false | Credentials> {
  const service = options?.service ?? 'default';
  return store.get(service) ?? false;
}

export async function resetGenericPassword(options?: { service?: string }): Promise<boolean> {
  const service = options?.service ?? 'default';
  return store.delete(service);
}

export async function canImplyAuthentication(): Promise<boolean> {
  return true;
}

export const _store = store;
