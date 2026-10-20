import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 审计 TEST-003：server 当前整体覆盖率低（路由层大量依赖集成测试），
    // 首期只对「已测模块」设下限防倒退；阈值随测试补齐逐步上调。
    // 注意：db/migration 集成测试需真实 DB，普通 vitest run 下会失败，
    // coverage-gate 读 coverage/coverage-final.json（需先全量跑生成）。
    // exclude 测试文件自身与脚本目录。
    // 2026-10-11 S-M1 批次后实测：lines/stmts 39.51% / funcs 65.11% /
    // branches 72.55%（新增 app.test 限流分桶 2 条）。阈值按实测留 ~4% 余量
    // 设定，防门禁抖动；随测试补齐逐步上调（routes 24% 是主要缺口）。
    //
    // testTimeout 30s：大量用例走 `await import(...)` 动态加载（loadModule
    // 模式），全量并行跑时首次 import 的 transform 成本在本机实测可达 200s+，
    // 顶穿 vitest 默认 5s 会间歇性误判超时（2026-10-20 发版前实测：
    // update-manifest.test.ts 4/16、notes.test.ts 1 条 flake；单文件跑均
    // <5s 通过）。全局提到 30s 兜底，不逐测试改写。
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      // json reporter 产出 coverage/coverage-final.json，供 CI 门禁 scripts/coverage-gate.mjs 读；
      // text 终端摘要保持。
      reporter: ['text', 'json'],
      reportsDirectory: './coverage',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/scripts/**'],
      thresholds: {
        lines: 36,
        functions: 60,
        branches: 68,
        statements: 36,
      },
    },
  },
});
