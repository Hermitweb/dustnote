/**
 * React Native CLI 配置（v2.0.4+）
 *
 * 背景：本仓库是 pnpm workspace，.npmrc 设置 node-linker=hoisted，所有依赖
 * 都安装在工作区根 node_modules/。mobile/ 作为 workspace 子包，其
 * node_modules/ 在 CI（hoisted 布局）下为空。React Native 0.74 的 autolinking
 *（@react-native-community/cli-platform-android 的 native_modules.gradle）
 * 默认从 mobile/node_modules/ 扫描原生模块——若该目录为空，autolinking 会
 * 静默跳过所有原生模块，生成的 PackageList.java 为空，构建仍能成功，但
 * APK 启动时 JS 调用未链接的原生模块（SafeAreaProvider / AsyncStorage 等）
 * 立即闪退。
 *
 * release.yml 里有一步 symlink 把根 node_modules 的 react-native* / @react-native*
 * 包链接进 mobile/node_modules/ 作为兜底；本配置在此基础上再做一层加固：
 * 显式把每个依赖的 root 指向工作区根 node_modules，autolinking 不再依赖
 * mobile/node_modules 的扫描结果。autolinking 会自动跳过纯 JS 包（无原生代码），
 * 因此把全部依赖都指向根 node_modules 是安全的。
 *
 * 参考：https://reactnative.dev/docs/config#dependencies
 */
const path = require('path');
const fs = require('fs');

const pkg = require('./package.json');
const rootNodeModules = path.resolve(__dirname, '..', 'node_modules');

const dependencies = {};
for (const dep of Object.keys(pkg.dependencies || {})) {
  // @dustnote/shared 是 workspace 包，由 metro.config.js 的 extraNodeModules
  // 处理，且无原生代码，跳过。
  if (dep === '@dustnote/shared') continue;

  const depRoot = path.join(rootNodeModules, dep);
  // 仅当根 node_modules 中确实存在该包时才配置，避免 pnpm 布局差异导致路径无效。
  if (!fs.existsSync(path.join(depRoot, 'package.json'))) continue;

  dependencies[dep] = { root: depRoot };
}

module.exports = {
  dependencies,
};
