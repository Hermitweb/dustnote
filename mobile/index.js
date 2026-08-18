/**
 * DustNote Android (React Native) 入口
 *
 * polyfill 必须是第一个 import —— metro bundler 按代码顺序同步 require，
 * 这样 polyfill.js 中的 install() 会在 App 及其依赖 (含 shared/src/crypto.ts)
 * 加载前执行，确保 global.crypto.subtle 已就绪。
 */

import './polyfill';

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
