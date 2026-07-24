const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const sharedPkg = path.resolve(__dirname, '..', 'shared');

const config = {
  watchFolders: [path.resolve(__dirname, '..', 'node_modules', '.pnpm'), sharedPkg],
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
