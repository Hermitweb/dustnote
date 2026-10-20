#!/usr/bin/env node
/**
 * 全仓统一测试编排器
 *
 * 目标：把分散在各子项目的 vitest / playwright / 文档检查脚本
 *       串成一条稳定的「生产可用性流水线」：
 *
 *   1. 文档齐全性 + 版本一致性 + 链接有效性
 *   2. 静态门禁（lint / typecheck / api 清单 / i18n / sw / errtext / tokens）
 *   3. 单元 + 集成测试（turbo 全子项目并行）
 *   4. 覆盖率门禁（每个子项目独立阈值）
 *   5. E2E（playwright）
 *   6. 生产冒烟（docker compose healthcheck + smoke-test.sh）
 *
 * 用法：
 *   node scripts/test-orchestrate.mjs               # 跑完整流水线
 *   node scripts/test-orchestrate.mjs --skip e2e    # 跳过 E2E
 *   node scripts/test-orchestrate.mjs --skip prod   # 跳过生产冒烟
 *   node scripts/test-orchestrate.mjs --only docs   # 只跑文档检查
 *   node scripts/test-orchestrate.mjs --coverage    # 强制开启覆盖率门禁
 *   node scripts/test-orchestrate.mjs --json        # JSON 格式输出
 *
 * 设计原则：
 *   - 任何 step 失败都能继续跑完（收集所有问题），最后汇总退出码
 *   - 单步耗时打印，便于定位瓶颈
 *   - 子进程流式输出，但保留头/尾摘要给 CI
 *   - 不引入新依赖：纯 Node.js
 */

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const args = argv.filter((a) => !a.startsWith('--'));

// --skip X / --only Y 的值：取紧跟在 flag 后的 token（可能逗号分隔多个）
function flagValue(name) {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) return '';
  return argv[i + 1];
}
const skip = new Set(flagValue('--skip') ? String(flagValue('--skip')).split(',') : []);
const only = new Set(flagValue('--only') ? String(flagValue('--only')).split(',') : []);
const jsonOut = flags.has('--json');
const coverage = flags.has('--coverage');

/** @type {{ name: string, cmd: string[], args: string[], cwd?: string, env?: Record<string,string>, optional?: boolean }[]} */
const STEPS = [
  {
    name: 'docs',
    label: '文档齐全性 / 版本一致性 / 链接有效性',
    cmd: ['node', ['scripts/check-docs.mjs']],
    optional: true,
  },
  {
    name: 'docs-readme-version',
    label: 'README 版本一致性',
    cmd: ['node', ['scripts/check-readme-version.mjs']],
    optional: true,
  },
  {
    name: 'docs-i18n',
    label: 'i18n 键覆盖',
    cmd: ['node', ['scripts/check-i18n.mjs']],
    optional: true,
  },
  {
    name: 'api-inventory',
    label: 'API 清单完整性',
    cmd: ['node', ['scripts/gen-api-inventory.mjs', '--check']],
    optional: true,
  },
  {
    name: 'sw-version',
    label: 'Service Worker 版本同步',
    cmd: ['node', ['scripts/check-sw-version.mjs']],
    optional: true,
  },
  {
    name: 'errtext',
    label: '错误文案可达性',
    cmd: ['node', ['scripts/check-error-text.mjs']],
    optional: true,
  },
  {
    name: 'tokens',
    label: '小程序设计令牌',
    cmd: ['node', ['scripts/gen-mp-tokens.mjs', '--check']],
    optional: true,
  },
  {
    name: 'env-vars',
    label: '环境变量一致性',
    cmd: ['node', ['scripts/check-env-vars.mjs']],
    optional: true,
  },
  {
    name: 'ui-scale',
    label: 'UI 缩放一致性',
    cmd: ['node', ['scripts/check-ui-scale.mjs']],
    optional: true,
  },
  {
    name: 'workflows',
    label: 'GitHub Actions 工作流合规',
    cmd: ['node', ['scripts/check-workflows.mjs']],
    optional: true,
  },
  {
    name: 'security-headers',
    label: '安全响应头',
    cmd: ['node', ['scripts/check-security-headers.mjs']],
    optional: true,
  },
  {
    name: 'action-pins',
    label: 'GitHub Action 引用钉版本',
    cmd: ['node', ['scripts/check-action-pins.mjs']],
    optional: true,
  },
  {
    name: 'docker-context',
    label: 'Docker 构建上下文',
    cmd: ['node', ['scripts/check-docker-context.mjs']],
    optional: true,
  },
  {
    name: 'compose-ports',
    label: 'Docker Compose 端口冲突',
    cmd: ['node', ['scripts/check-compose-ports.mjs']],
    optional: true,
  },
  {
    name: 'lint',
    label: 'ESLint',
    cmd: ['pnpm', ['lint']],
  },
  {
    name: 'typecheck',
    label: 'TypeScript 类型检查',
    cmd: ['pnpm', ['typecheck']],
  },
  {
    name: 'test',
    label: coverage ? '单元测试（带覆盖率门禁）' : '单元测试',
    cmd: ['pnpm', coverage ? ['test:coverage'] : ['test']],
  },
  {
    name: 'e2e',
    label: '端到端 Playwright',
    cmd: ['npx', ['playwright', 'test']],
  },
  {
    name: 'prod-smoke',
    label: '生产环境冒烟（docker compose up + smoke-test.sh）',
    cmd: ['bash', ['scripts/smoke-test.sh']],
  },
];

const FILTER_BY_ONLY = (s) =>
  only.size === 0 || only.has(s.name) || (s.name === 'test' && only.has('coverage'));

function runStep(step) {
  if (!FILTER_BY_ONLY(step)) {
    return Promise.resolve({ name: step.name, status: 'skip', ms: 0 });
  }
  if (skip.has(step.name)) {
    return Promise.resolve({ name: step.name, status: 'skip', ms: 0 });
  }
  const [bin, binArgs] = step.cmd;
  const allArgs = [...binArgs, ...args.filter((a) => !a.startsWith('--'))];
  return new Promise((resolve) => {
    const start = performance.now();
    const child = spawn(bin, allArgs, {
      cwd: step.cwd ?? process.cwd(),
      env: { ...process.env, ...(step.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => {
      const s = b.toString();
      out += s;
    });
    child.stderr.on('data', (b) => {
      const s = b.toString();
      err += s;
    });
    child.on('close', (code) => {
      const ms = Math.round(performance.now() - start);
      const status =
        code === 0 ? 'pass' : step.optional && !flags.has('--strict') ? 'warn' : 'fail';
      resolve({
        name: step.name,
        status,
        ms,
        code,
        outTail: tail(out, 40),
        errTail: tail(err, 20),
      });
    });
    child.on('error', (e) => {
      const ms = Math.round(performance.now() - start);
      resolve({ name: step.name, status: 'fail', ms, error: String(e) });
    });
  });
}

function tail(s, lines) {
  if (!s) return '';
  const arr = s.trimEnd().split('\n');
  return arr.slice(Math.max(0, arr.length - lines)).join('\n');
}

(async () => {
  const results = [];
  const t0 = performance.now();
  for (const step of STEPS) {
    if (!jsonOut) {
      process.stderr.write(`\n=== ${step.label} ===\n`);
    }
    const r = await runStep(step);
    results.push({ ...r, label: step.label });
    if (!jsonOut) {
      const tag =
        r.status === 'pass'
          ? '\x1b[32mPASS\x1b[0m'
          : r.status === 'warn'
            ? '\x1b[33mWARN\x1b[0m'
            : r.status === 'skip'
              ? '\x1b[36mSKIP\x1b[0m'
              : '\x1b[31mFAIL\x1b[0m';
      process.stderr.write(`--- ${tag} ${step.name} (${r.ms}ms)\n`);
      if (r.status === 'fail') {
        if (r.errTail) process.stderr.write(`stderr tail:\n${r.errTail}\n`);
        if (r.outTail) process.stderr.write(`stdout tail:\n${r.outTail}\n`);
      }
    }
  }
  const total = Math.round(performance.now() - t0);

  const summary = {
    totalMs: total,
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    warn: results.filter((r) => r.status === 'warn').length,
    skip: results.filter((r) => r.status === 'skip').length,
    steps: results,
  };

  if (jsonOut) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    process.stderr.write(
      `\n========= SUMMARY =========\n` +
        `total: ${summary.totalMs}ms  ` +
        `pass: ${summary.pass}  fail: ${summary.fail}  ` +
        `warn: ${summary.warn}  skip: ${summary.skip}\n`
    );
  }
  process.exit(summary.fail > 0 ? 1 : 0);
})();
