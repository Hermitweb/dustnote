module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { chrome: '53', ios: '9', android: '5' } }],
    '@babel/preset-typescript',
    ['@babel/preset-react', { runtime: 'automatic' }],
  ],
};
