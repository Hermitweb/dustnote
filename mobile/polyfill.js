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
 */

import 'react-native-get-random-values';
import { install } from 'react-native-quick-crypto';

install();
