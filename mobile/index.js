/**
 * DustNote Android (React Native) 入口
 *
 * Polyfill 必须在所有其他 import 之前加载：
 * - react-native-get-random-values：为 @noble/hashes 提供 CSPRNG（crypto.getRandomValues）
 * - react-native-quick-crypto/auto：补齐 crypto.subtle（AES-GCM / HKDF / HMAC），
 *   RN 0.74 默认不提供 WebCrypto，shared/src/crypto.ts 依赖 subtle.importKey/sign/encrypt/decrypt
 */

import 'react-native-get-random-values';
import 'react-native-quick-crypto/auto';

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
