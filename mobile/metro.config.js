const path = require('path');
const fs = require('fs');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const sharedPkg = path.resolve(__dirname, '..', 'shared');
const rootNodeModules = path.resolve(__dirname, '..', 'node_modules');

// pnpm's virtual store only exists in the default (symlinked) layout.
// With node-linker=hoisted (used in CI) there is no .pnpm directory, so we
// only add it to watchFolders when present to avoid Metro failing on a
// non-existent path.
const watchFolders = [sharedPkg, rootNodeModules];
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
      // 显式映射 react，确保 pnpm hoisted 布局下所有模块解析到同一份 React 实例。
      // 若缺少此映射，某些原生模块（经 nodeModulesPaths 回退到 workspace root）
      // 可能解析到不同的 react 副本，导致 "Cannot read property 'useRef' of null"。
      react: path.resolve(rootNodeModules, 'react'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
