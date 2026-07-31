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
