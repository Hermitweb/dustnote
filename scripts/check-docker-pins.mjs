#!/usr/bin/env node
/**
 * check-docker-pins.mjs — 校验 Dockerfile / docker-compose.yml 的 base 镜像是否 digest-pin。
 *
 * 与 pin-base-image-digests.mjs（生成器，需 docker + 外网解析 manifest digest）配套：
 * 生成器把浮动 tag 写成 `node:22-alpine@sha256:...`；本门禁做**不依赖 docker 的格式校验**——
 * 只要 Dockerfile 的 FROM / compose 的 image 引用里仍残留浮动 tag（不带 @sha256:）就失败。
 *
 * 本地环境无 docker 无法生成 digest 时，可临时把本条从 verify 摘掉或允许浮动，
 * 但提交前应保证已 pin。门禁本身只锁「pin 的形式」，不锁 digest 值。
 *
 * 用法：node scripts/check-docker-pins.mjs
 */
import { readFileSync } from 'node:fs';

const TARGETS = [
  { file: 'Dockerfile', kind: 'dockerfile' },
  { file: 'server/Dockerfile', kind: 'dockerfile' },
  { file: 'docker-compose.yml', kind: 'compose' },
];

// 需要 pin 的镜像 tag 前缀（与 pin-base-image-digests.mjs 的 IMAGES 一致）
const REQUIRED = ['node:22-alpine', 'caddy:2-alpine'];

let failed = false;
for (const { file, kind } of TARGETS) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // 文件不存在（如未引入 server/Dockerfile）则跳过
  }

  for (const tag of REQUIRED) {
    if (kind === 'dockerfile') {
      // FROM node:22-alpine（浮动） → 应改为 FROM node:22-alpine@sha256:...
      const unpin = new RegExp(
        `^FROM\\s+${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(?!@sha256:)`,
        'm'
      );
      if (unpin.test(text)) {
        failed = true;
        console.error(`✗ ${file}: FROM ${tag} 未 digest-pin（应为 ${tag}@sha256:...）`);
      }
    } else {
      const unpin = new RegExp(
        `image:\\s*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(?!@sha256:)`
      );
      if (unpin.test(text)) {
        failed = true;
        console.error(`✗ ${file}: image: ${tag} 未 digest-pin（应为 ${tag}@sha256:...）`);
      }
    }
  }
}

if (failed) {
  console.error(
    '\n请先运行 `pnpm pin-digests` 把浮动 tag 钉到 digest（需 docker + 外网），再提交。'
  );
  process.exit(1);
}
console.log('✓ Docker base 镜像均已 digest-pin（格式校验通过）');
