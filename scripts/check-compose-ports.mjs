#!/usr/bin/env node
/**
 * compose 端口冲突守卫（v2.5.47 部署阻断事故固化）
 *
 * 事故模型：`docker-compose.yml` 里同一个容器端口被两条互相重叠的绑定声明
 * （回环 + 所有接口），容器启动时第二条 `address already in use`。
 * 这类缺陷对 CI 完全隐形——构建、单测、e2e 都不碰宿主端口；它只在**真部署**时
 * 现形，而那一刻 upgrade.sh 已经 down 掉旧容器，代价是线上中断。
 *
 * 判定逻辑在 scripts/compose-ports.mjs（纯函数 + 单测），这里只负责读文件、报告、定退出码。
 *
 * 用法：node scripts/check-compose-ports.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPortConflicts } from './compose-ports.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = join(ROOT, 'docker-compose.yml');

const { conflicts, skipped } = findPortConflicts(readFileSync(COMPOSE, 'utf8'));

if (conflicts.length) {
  console.error('[FAIL] docker-compose.yml 存在无法共存的端口绑定：');
  for (const c of conflicts) {
    console.error(`  - service ${c.service}:`);
    console.error(`      ${c.a}`);
    console.error(`      ${c.b}`);
  }
  console.error('两条绑定声明的宿主端口相同且 IP 重叠，容器启动必失败（address already in use）。');
  console.error('修复：删掉多余的一条（同一容器端口只保留一条宿主绑定）。');
  process.exit(1);
}

console.log(
  `✓ compose-ports: 无冲突绑定${skipped ? `（${skipped} 条含无默认值的变量/区间端口，未参与判定）` : ''}`
);
