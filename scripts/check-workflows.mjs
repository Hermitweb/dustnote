#!/usr/bin/env node
/**
 * workflow 结构守卫（pnpm workflows:check）
 *
 * 起因：给官网加 Pages 部署 job 时漏写了 runs-on。GitHub 对 workflow 的校验是
 * 「整份拒绝」——一个 job 缺字段，这个文件里所有 job 都不会跑，而本地、lint、
 * 类型检查、单测全都不知道。之前的拨测假 SHA 静默失效是同一类问题：
 * 没人检查的东西一定烂，CI 配置恰好是最容易没人检查的东西。
 *
 * 检查项（任一失败 exit 1）：
 *  1. 每份 workflow 能被 YAML 解析；
 *  2. jobs 非空，每个 job 有 runs-on（走 uses 复用工作流时豁免）；
 *  3. 每个 job 有 steps 且非空（或 uses）；
 *  4. needs 指向的 job 必须存在于同一份文件——拼错的 needs 让 job 永不启动；
 *  5. 每个 job 有 timeout-minutes：没超时就可能挂到 GitHub 的 6 小时上限；
 *  6. environment.url 必须是 https（表达式形式放行）。
 *  7. 用 actions/setup-node 却不装任何依赖的 job，必须显式 package-manager-cache: false。
 *     该输入默认是真，setup-node 会按 package.json 的 packageManager 去恢复/保存 pnpm store。
 *     job 不 install 时 store 目录根本不存在——缓存**命中**时看不出问题（恢复即建目录），
 *     一旦 pnpm-lock.yaml 变了、新 key 无缓存可恢复，Post 保存那步直接 Path Validation
 *     Error 把 job 跑红。PR #16 的 Docs workflow 首跑即如此；同一形状的 nightly-status.yml
 *     拨测 job 当时只是运气好命中缓存，已一并关掉。这类「平时绿、换锁文件就红」的
 *     间歇故障最难查，所以做成结构检查而不是等人踩。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, '.github', 'workflows');
const JSON_OUT = process.argv.includes('--json');
const DOLLAR = String.fromCharCode(36);

/** 纯函数：给一份 workflow 文本，返回问题列表。测试直接打这里。 */
export function checkWorkflow(text, label) {
  const problems = [];
  let doc;
  try {
    doc = load(text);
  } catch (e) {
    return [label + ' YAML 解析失败：' + e.message.split('\n')[0]];
  }
  if (!doc || typeof doc !== 'object') return [label + ' 内容为空'];
  // GitHub Actions 写 on: ，而 YAML 1.1 会把它读成布尔 true，两种键都要认
  const triggers = doc.on !== undefined ? doc.on : doc[true];
  if (triggers === undefined) problems.push(label + ' 没有 on: 触发器');
  const jobs = doc.jobs;
  if (!jobs || typeof jobs !== 'object') return problems.concat(label + ' 没有 jobs');
  const names = Object.keys(jobs);
  if (!names.length) problems.push(label + ' jobs 为空');
  for (const name of names) {
    const job = jobs[name] || {};
    const at = label + ' 的 job ' + name;
    const reusable = Boolean(job.uses);
    if (!reusable) {
      if (!job['runs-on'])
        problems.push(at + ' 缺 runs-on：GitHub 会整份 workflow 拒绝加载，所有 job 一起不跑');
      if (!Array.isArray(job.steps) || !job.steps.length) problems.push(at + ' 没有 steps');
      if (!job['timeout-minutes']) problems.push(at + ' 缺 timeout-minutes（默认能挂到 6 小时）');
    }
    if (job.needs) {
      // needs 三种写法都要认：单个字符串、数组、以及 { job: { ... } } 映射形式
      const list =
        typeof job.needs === 'string'
          ? [job.needs]
          : Array.isArray(job.needs)
            ? job.needs
            : Object.keys(job.needs);
      for (const n of list)
        if (!names.includes(n)) problems.push(at + ' 的 needs 指向不存在的 job：' + n);
    }
    // setup-node 的 package-manager-cache 默认是真：它会按 package.json 的 packageManager
    // 去缓存 pnpm store。job 若不装依赖，store 目录不存在，Post 步骤直接报错把 job 跑红。
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const nodeStep = steps.find(
      (st) => typeof st?.uses === 'string' && st.uses.startsWith('actions/setup-node@')
    );
    if (nodeStep) {
      const installs = steps.some(
        (st) => typeof st?.run === 'string' && /\b(pnpm|npm|yarn)\s+(install|ci|add)\b/.test(st.run)
      );
      const withs = nodeStep.with || {};
      const cacheOff = withs['package-manager-cache'] === false || withs.cache === '';
      if (!installs && !cacheOff)
        problems.push(
          at +
            ' 用 setup-node 却不装依赖，必须显式 package-manager-cache: false（锁文件一变、新 key 无缓存可恢复，Post 保存就会报 Path Validation Error）'
        );
    }
    const env = job.environment;
    if (env && typeof env === 'object' && env.url) {
      const u = String(env.url);
      if (!/^https:\/\//.test(u) && !u.includes(DOLLAR + '{'))
        problems.push(at + ' 的 environment.url 不是 https：' + u);
    }
  }
  return problems;
}

export function checkAll(dir = DIR) {
  const problems = [];
  const files = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();
  for (const f of files) problems.push(...checkWorkflow(readFileSync(join(dir, f), 'utf8'), f));
  return { files, problems };
}

function main() {
  const { files, problems } = checkAll();
  if (JSON_OUT) {
    console.log(JSON.stringify({ files, problems }, null, 2));
    if (problems.length) process.exitCode = 1;
    return;
  }
  if (problems.length) {
    console.error('');
    console.error('[FAIL] workflow 结构检查失败：' + problems.length + ' 处');
    for (const p of problems) console.error('  - ' + p);
    console.error('');
    console.error('workflow 写错不会让任何本地命令变红，它只会让 CI 静默不跑。');
    process.exitCode = 1;
    return;
  }
  console.log(
    'OK：' + files.length + ' 份 workflow 结构一致（runs-on / steps / needs / 超时 / https）'
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
