const path = require('path');
const fs = require('fs');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const sharedPkg = path.resolve(__dirname, '..', 'shared');

// pnpm's virtual store only exists in the default (symlinked) layout.
// With node-linker=hoisted (used in CI) there is no .pnpm directory, so we
// only add it to watchFolders when present to avoid Metro failing on a
// non-existent path.
const watchFolders = [sharedPkg];
const pnpmStore = path.resolve(__dirname, '..', 'node_modules', '.pnpm');
if (fs.existsSync(pnpmStore)) {
  watchFolders.push(pnpmStore);
}

const config = {
  watchFolders,
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(__dirname, '..', 'node_modules'),
    ],
    extraNodeModules: {
      '@babel/runtime': path.resolve(__dirname, '..', 'node_modules', '@babel', 'runtime'),
      '@dustnote/shared': path.resolve(sharedPkg, 'src'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
