const path = require('path');
const fs = require('fs');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const sharedPkg = path.resolve(__dirname, '..', 'shared');
const clientCorePkg = path.resolve(__dirname, '..', 'client-core');
const rootNodeModules = path.resolve(__dirname, '..', 'node_modules');

// pnpm's virtual store only exists in the default (symlinked) layout.
// With node-linker=hoisted (used in CI) there is no .pnpm directory, so we
// only add it to watchFolders when present to avoid Metro failing on a
// non-existent path.
const watchFolders = [sharedPkg, clientCorePkg, rootNodeModules];
const pnpmStore = path.resolve(rootNodeModules, '.pnpm');
if (fs.existsSync(pnpmStore)) {
  watchFolders.push(pnpmStore);
}

const config = {
  watchFolders,
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules'), rootNodeModules],
    // Note: @babel/runtime is intentionally NOT mapped here. With
    // node-linker=hoisted it is resolvable via nodeModulesPaths, and mapping
    // it in extraNodeModules caused Metro to skip extension resolution for
    // subpath imports like @babel/runtime/helpers/interopRequireDefault.
    extraNodeModules: {
      '@dustnote/shared': path.resolve(sharedPkg, 'src'),
      // client-core 同 shared：映射到 src（Metro 直接编译 TS 源码）。
      // 不映射时 Metro 走 node_modules 解析 package.json main=dist/index.js，
      // hoisted 布局下该链接不存在；且 Metro 默认不跟随 symlink，
      // CI 的手工 symlink 兜底也无效。
      '@dustnote/client-core': path.resolve(clientCorePkg, 'src'),
      react: path.resolve(rootNodeModules, 'react'),
    },
    // 强制所有 react / react/* 导入解析到 workspace root 的同一份实例。
    //
    // 背景：pnpm hoisted 布局下 mobile/node_modules/react 是指向
    // .pnpm/react@18.2.0/node_modules/react 的 junction，与根 node_modules/react
    // （物理目录）是两份不同的物理副本。原生模块（react-native-*, @react-native-*
    // 等）通过 hierarchical lookup 从自身目录向上查找时，会先命中
    // mobile/node_modules/react（pnpm store 副本），而 App 代码经 extraNodeModules
    // 解析到根 node_modules/react（hoisted 副本）→ bundle 内出现两份 React 实例 →
    // ReactSharedInternals.Hook dispatcher 不匹配 → "Cannot read property 'useRef'
    // of null" 启动崩溃。
    //
    // extraNodeModules 仅在默认解析失败时作为 fallback 触发，无法覆盖上述场景，
    // 故必须用 resolveRequest 在解析器入口显式拦截 react 的所有导入（含 JSX transform
    // 产生的 react/jsx-runtime、react/jsx-dev-runtime 子路径），统一重定向到 root。
    resolveRequest(context, moduleName, platform) {
      // 重定向 react-native-quick-base64 → 纯 JS base64-js
      //
      // 背景：react-native-quick-base64 是纯 TurboModule（package.json 无
      // `react-native` 字段，android 仅有 codegen 生成的 TurboModule spec，
      // 无传统 ReactPackage），在旧架构（newArchEnabled=false）下其 TurboModule
      // (QuickBase64) 无法注册到 TurboModuleRegistry —— require 时抛
      // "TurboModuleRegistry.getEnforcing: 'QuickBase64' could not be found"。
      // @craftzdog/react-native-buffer 在 RN 环境强制 require 它，导致
      // react-native-quick-crypto 整个模块加载失败，crypto.subtle 不可用。
      //
      // 修复：重定向到 base64-js（纯 JS 实现，react-native-buffer 在非 RN
      // 环境的 fallback），功能等价，性能略低但避免崩溃。crypto.subtle 仍由
      // react-native-quick-crypto 的原生 QuickCryptoModule（已 autolinked）提供。
      if (moduleName === 'react-native-quick-base64') {
        try {
          return {
            type: 'sourceFile',
            filePath: require.resolve('base64-js', { paths: [rootNodeModules] }),
          };
        } catch {
          // base64-js 找不到时回退默认解析（由 nodeModulesPaths 兜底）
        }
      }
      if (moduleName === 'react' || moduleName.startsWith('react/')) {
        try {
          return {
            type: 'sourceFile',
            filePath: require.resolve(moduleName, { paths: [rootNodeModules] }),
          };
        } catch {
          // root node_modules 找不到 react（异常环境）时回退默认解析，
          // 由 nodeModulesPaths + extraNodeModules 兜底。
        }
      }
      // 非react模块：委托默认解析器（context.resolveRequest 指向内置解析器，
      // 非 decltype 当前自定义函数，不会递归）。
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
