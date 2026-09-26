#!/usr/bin/env node
/**
 * 基础镜像 digest 固定（审计 SEC-008）
 *
 * 把 Dockerfile / docker-compose.yml 里的浮动 tag（node:22-alpine、caddy:2-alpine）
 * 改写为 `tag@sha256:<manifest-list 摘要>`，锁死上游镜像内容——tag 被重指时
 * 构建结果不会静默漂移。需要本机有 docker（脚本用 docker buildx imagetools
 * 解析多架构 manifest list 摘要）。
 *
 * 用法：
 *   pnpm pin-digests            # 解析并写回
 *   pnpm pin-digests --dry-run  # 只打印将要写入的值
 *
 * 升级基础镜像时：改回浮动 tag（或直接改 tag 后重跑本脚本），再跑一次即可
 * 得到新 digest；Dependabot 的 docker 生态更新也会同步 digest。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');

/** 目标：文件 → 需要固定的镜像引用（同一 tag 在所有文件里写成同一 digest） */
const TARGETS = [
  { file: 'Dockerfile', kind: 'dockerfile' },
  { file: 'server/Dockerfile', kind: 'dockerfile' },
  { file: 'docker-compose.yml', kind: 'compose' },
];

/** 需要固定的镜像（tag 形式，不含 digest） */
const IMAGES = ['node:22-alpine', 'caddy:2-alpine'];

function resolveDigest(image) {
  const attempts = [
    ['buildx', ['buildx', 'imagetools', 'inspect', image, '--format', '{{.Manifest.Digest}}']],
    ['manifest', ['manifest', 'inspect', '--verbose', image]],
  ];
  for (const [name, args] of attempts) {
    try {
      const out = execFileSync('docker', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .trim()
        .split('\n')[0];
      if (/^sha256:[0-9a-f]{64}$/.test(out)) return out;
      if (name === 'manifest') {
        // manifest inspect --verbose 输出 JSON，取顶层 Descriptor.digest
        const parsed = JSON.parse(out);
        const digest = Array.isArray(parsed)
          ? parsed[0]?.Descriptor?.digest
          : parsed?.Descriptor?.digest;
        if (typeof digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(digest)) return digest;
      }
    } catch {
      /* 尝试下一种方式 */
    }
  }
  throw new Error(
    `无法解析 ${image} 的 digest。请确认本机已安装 docker 且能访问镜像仓库（docker login / 代理），` +
      '或临时保留浮动 tag（不安全但可用）。'
  );
}

const digests = new Map();
for (const image of IMAGES) {
  const digest = resolveDigest(image);
  digests.set(image, digest);
  console.log(`✓ ${image} → ${digest}`);
}

if (DRY_RUN) {
  console.log('\n[dry-run] 未写回文件。');
  process.exit(0);
}

let changed = 0;
for (const { file, kind } of TARGETS) {
  const before = readFileSync(file, 'utf8');
  let after = before;

  for (const [image, digest] of digests) {
    const escaped = image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (kind === 'dockerfile') {
      // FROM node:22-alpine ... → FROM node:22-alpine@sha256:...
      // 已是 @sha256 的旧值先剥掉再写新值（幂等）
      const re = new RegExp(`^FROM ${escaped}(?:@sha256:[0-9a-f]{64})?(\\s|$)`, 'gm');
      after = after.replace(re, (_m, tail) => `FROM ${image}@${digest}${tail}`);
    } else {
      // compose 的 image: caddy:2-alpine → image: caddy:2-alpine@sha256:...
      const re = new RegExp(`image: ${escaped}(?:@sha256:[0-9a-f]{64})?`, 'g');
      after = after.replace(re, `image: ${image}@${digest}`);
    }
  }

  if (after !== before) {
    writeFileSync(file, after);
    changed += 1;
    console.log(`✓ 已更新 ${file}`);
  } else {
    console.log(`- ${file} 无变化`);
  }
}

console.log(`\n完成：${changed} 个文件已写入 digest。`);
console.log('提示：固定后可跑一次 `docker compose build` 验证拉取与构建正常。');
