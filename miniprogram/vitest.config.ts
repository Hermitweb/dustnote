/**
 * 小程序单元测试基建（审计 TEST-004 补课，2026-09-26）
 *
 * 与 web / mobile / desktop 同一套做法：**只 mock 平台 I/O 边界**（@tarojs/taro 的
 * 存储与交互 API），业务逻辑跑真身 —— 离线队列、明文缓存、搜索索引、主题/材质持久化
 * 正是"错了会丢数据或看不到笔记"的地方，而它们在 weapp 里没有测试环境可跑。
 *
 * 不追覆盖率：用例列表就是承诺。
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const m = (p: string) => fileURLToPath(new URL(`./test/mocks/${p}`, import.meta.url));

export default defineConfig({
  define: {
    // Taro 的编译期环境标记：测试里当作 weapp，走真机分支（H5 分支另有 page-solid 差异）
    'process.env.TARO_ENV': JSON.stringify('weapp'),
  },
  resolve: {
    alias: [{ find: /^@tarojs\/taro$/, replacement: m('taro.ts') }],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 20_000,
  },
});
