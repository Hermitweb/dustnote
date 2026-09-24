/**
 * react-native 桩：只保留被测模块触达的表面（Alert/AppState/Platform）。
 * AppState._fire 供测试模拟前后台切换。
 */
export const Alert = {
  alert: (..._args: unknown[]) => undefined,
};

type Listener = (state: string) => void;
const listeners = new Set<Listener>();
export const AppState = {
  currentState: 'active' as string,
  addEventListener(_type: string, cb: Listener) {
    listeners.add(cb);
    return { remove: () => listeners.delete(cb) };
  },
  _fire(state: string) {
    AppState.currentState = state;
    for (const l of listeners) l(state);
  },
};

export const Platform = {
  OS: 'android' as const,
  Version: 34,
  constants: {
    Brand: 'TestBrand',
    Model: 'TestModel',
    Release: '14',
    apiLevel: 34,
  },
};

export default { Alert, AppState, Platform };
