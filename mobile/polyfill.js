/**
 * Crypto/Random polyfill for React Native
 *
 * 必须在 App 及其依赖加载前执行。ES module 会 hoist 所有 import，
 * 故独立成文件并通过 `import './polyfill'` 触发 side-effect，
 * 确保 metro bundler 按代码顺序同步 require 本模块。
 *
 * - react-native-get-random-values：为 @noble/hashes 提供 CSPRNG (crypto.getRandomValues)
 * - react-native-quick-crypto (install)：补齐 crypto.subtle
 *   (AES-GCM / HKDF / HMAC)，RN 0.74 默认不提供 WebCrypto，
 *   shared/src/crypto.ts 依赖 subtle.importKey/sign/encrypt/decrypt
 *
 * 注：react-native-quick-crypto <0.7 支持 `import 'react-native-quick-crypto/auto'`
 * 自动 patch；0.7+ 移除了 /auto 子路径，需显式调用 install() 挂载
 * global.crypto / global.Buffer。
 *
 * v2.3.4 修复：原 `import { install } from 'react-native-quick-crypto'` 是静态
 * import，如果 quick-crypto 的 JS 模块初始化抛错（JSI 绑定缺失 / CMake 未编译
 * 等），metro 会把异常冒泡到 index.js 的 `import './polyfill'`，导致后续所有
 * import（含 React 本身）加载失败 → "Cannot read property 'useRef' of null"。
 * 改为 require() + 双层 try/catch：
 *   1. 外层 catch require() 本身的模块加载错误
 *   2. 内层 catch install() 的全局补丁安装错误
 * 即使 crypto 完全不可用，App 也能启动到 ErrorBoundary / 模式选择页。
 */

// 0. TextEncoder/TextDecoder polyfill —— 必须在所有依赖加载前执行。
//    Hermes 引擎不提供 TextEncoder/TextDecoder 全局对象，而 @noble/hashes
//    (经 @dustnote/shared 的 HKDF/deriveSecrets 调用) 的 utf8 编解码依赖它们。
//    缺失会导致 Zustand store 初始化时 ReferenceError: Property 'TextDecoder'
//    doesn't exist 崩溃（v2.3.5 修复 React 实例问题后暴露）。
//    fast-text-encoding 是纯 JS 实现，挂载到 global.TextEncoder/TextDecoder。
import 'fast-text-encoding';

// 1. getRandomValues polyfill —— 此包只做 global.crypto.getRandomValues 赋值，
//    无原生 JSI 依赖，不会触发模块加载异常。
import 'react-native-get-random-values';

// 2. react-native-quick-crypto —— JSI 原生模块，install() 挂载 crypto.subtle +
//    global.Buffer。用 require() 而非 import，确保模块加载异常被 try/catch
//    捕获，不会冒泡中断 index.js 后续 import（React 等）。
//    v2.3.5 诊断增强：把加载状态写入 globalThis.__QCRYPTO_STATUS 便于 UI 显示。
let quickCryptoInstall = null;
// @ts-expect-error - 诊断全局变量
globalThis.__QCRYPTO_STATUS = {
  requireOk: false,
  installOk: false,
  requireError: null,
  installError: null,
};
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('react-native-quick-crypto');
  quickCryptoInstall = typeof mod.install === 'function' ? mod.install : null;
  // @ts-expect-error - 诊断全局变量
  globalThis.__QCRYPTO_STATUS.requireOk = true;
  globalThis.__QCRYPTO_STATUS.modType = typeof mod;
  globalThis.__QCRYPTO_STATUS.hasInstall = typeof mod.install === 'function';
} catch (e) {
  // 常见原因：JSI 绑定未编译（CMake 缺失）、Hermes 新架构不兼容、
  // TurboModuleRegistry 找不到原生模块。捕获后继续，App 可启动但 crypto 不可用。
  // eslint-disable-next-line no-console
  console.error('[DustNote] react-native-quick-crypto module load failed:', e);
  // @ts-expect-error - 诊断全局变量
  globalThis.__QCRYPTO_STATUS.requireError = e instanceof Error ? e.message : String(e);
}

// 3. install() 在某些设备/架构下可能抛异常（如 Hermes 新架构兼容问题），
//    用 try/catch 包裹防止未捕获异常导致应用启动即白屏崩溃。
//    crypto.subtle 不可用时 shared/src/crypto.ts 会降级报错，
//    但至少应用能启动并展示 ErrorBoundary，而非直接白屏崩溃。
try {
  if (quickCryptoInstall) {
    quickCryptoInstall();
    // @ts-expect-error - 诊断全局变量
    globalThis.__QCRYPTO_STATUS.installOk = true;
  }
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[DustNote] react-native-quick-crypto install failed:', e);
  // @ts-expect-error - 诊断全局变量
  globalThis.__QCRYPTO_STATUS.installError = e instanceof Error ? e.message : String(e);
}
