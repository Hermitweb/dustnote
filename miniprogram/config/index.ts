/**
 * Taro 小程序全局配置
 *
 * 支持平台：微信 / 支付宝 / 抖音 / 百度 / 京东 / QQ / H5
 *
 * 详见 https://taro-docs.jd.com/docs/next/project-config
 */
import path from 'path';

export default {
  projectName: 'dustnote',
  date: '2026-6-27',
  designWidth: 750,
  deviceRatio: { 640: 2.34 / 2, 750: 1, 828: 1.81 / 2, 375: 2 / 1 },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: ['@tarojs/plugin-framework-react'],
  defineConstants: {},
  copy: { patterns: [], options: {} },
  framework: 'react',
  compiler: 'webpack5',
  compilerOptions: {
    typescript: { enable: true, tsconfigPath: 'tsconfig.json' },
    babel: { enable: true },
  },
  mini: {
    webpackChain(chain: any) {
      // 禁用 webpackbar，避免旧版 webpackbar 5 与 webpack 5.78+ 的 ProgressPlugin 不兼容
      chain.plugins.delete('webpackbar');
      // 让 babel-loader 处理 @dustnote/shared 中的新语法（数字分隔符等）
      const scriptRule = chain.module.rules.get('script');
      if (scriptRule) {
        // 清空默认 exclude，让 babel-loader 处理 node_modules 中用到新语法的包
        scriptRule.exclude.clear();
        scriptRule.include
          .clear()
          .add(path.resolve(__dirname, '..', 'src'))
          .add(path.resolve(__dirname, '..', '..', 'shared'))
          .add(path.resolve(__dirname, '..', 'node_modules'))
          .add(path.resolve(__dirname, '..', '..', 'node_modules'));
      }
    },
    postcss: { pxtransform: { enable: true, config: {} } },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    output: { filename: 'js/[name].[hash:8].js', chunkFilename: 'js/[name].[chunkhash:8].js' },
    miniCssExtractPluginOption: { ignoreOrder: true, filename: 'css/[name].[hash].css' },
    postcss: { autoprefixer: { enable: true } },
    devServer: {
      port: 10086,
      host: '0.0.0.0',
      proxy: { '/api': { target: 'http://localhost:3210', changeOrigin: true } },
    },
    // 目标浏览器不识别 zod 等依赖里的 ?? 与 class field，需 babel 转译
    webpackChain(chain: any) {
      // 禁用 react-refresh，避免其 loader 在 babel 之前破坏新语法
      chain.plugins.delete('reactRefresh');
      // 禁用 webpackbar，避免旧版 webpackbar 5 与 webpack 5.78+ 的 ProgressPlugin 不兼容
      chain.plugins.delete('webpackbar');
      chain.module
        .rule('h5script')
        .test(/\.(js|jsx|ts|tsx)$/)
        .include.add(path.resolve(__dirname, '..', 'src'))
        .add(path.resolve(__dirname, '..', '..', 'shared', 'src'))
        .add(path.resolve(__dirname, '..', '..', 'shared', 'dist'))
        .add(path.resolve(__dirname, '..', '..', 'node_modules'))
        .end()
        .use('babel')
        .loader('babel-loader')
        .options({
          cacheDirectory: true,
          presets: [
            [
              '@babel/preset-env',
              { targets: { browsers: ['> 1%', 'last 2 versions', 'not dead'] } },
            ],
            '@babel/preset-typescript',
            ['@babel/preset-react', { runtime: 'automatic' }],
          ],
          plugins: [
            '@babel/plugin-proposal-class-properties',
            '@babel/plugin-proposal-private-methods',
            '@babel/plugin-proposal-nullish-coalescing-operator',
            '@babel/plugin-proposal-optional-chaining',
          ],
        });
    },
  },
};
