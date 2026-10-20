#!/usr/bin/env node
/**
 * 基础镜像 digest 固定（审计 SEC-008）
 *
 * 把 Dockerfile / docker-compose.yml 里的浮动 tag（node:22-alpine、caddy:2-alpine）
 * 改写为 `tag@sha256:<manifest-list 摘要>`，锁死上游镜像内容——tag 被重指时
 * 构建结果不会静默漂移。
 *
 * 解析 digest 有两条路，按序尝试：
 *   1. docker buildx imagetools inspect（需本机 docker）
 *   2. Registry HTTP API（纯 HTTP，无需 docker）——CI 镜像与无 docker 的开发机都能用
 *
 * 第 2 条走标准 Docker Hub token 流程；若目标在镜像源（如国内 daocloud 等），
 * 用环境变量覆盖端点：
 *   DUSTNOTE_DOCKER_REGISTRY   registry 基址，如 https://registry-1.docker.io
 *   DUSTNOTE_DOCKER_TOKEN_URL  token 端点，如 https://auth.docker.io/token
 *   DUSTNOTE_DOCKER_SERVICE    token service 参数，默认 registry.docker.io
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

const REGISTRY = process.env.DUSTNOTE_DOCKER_REGISTRY ?? 'https://registry-1.docker.io';
const TOKEN_URL = process.env.DUSTNOTE_DOCKER_TOKEN_URL ?? 'https://auth.docker.io/token';
const SERVICE = process.env.DUSTNOTE_DOCKER_SERVICE ?? 'registry.docker.io';

/** 目标：文件 → 需要固定的镜像引用（同一 tag 在所有文件里写成同一 digest） */
const TARGETS = [
  { file: 'Dockerfile', kind: 'dockerfile' },
  { file: 'server/Dockerfile', kind: 'dockerfile' },
  { file: 'docker-compose.yml', kind: 'compose' },
];

/** 需要固定的镜像（tag 形式，不含 digest） */
const IMAGES = ['node:22-alpine', 'caddy:2-alpine'];

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

/** 走 docker 的两条命令。 */
function resolveDigestViaDocker(image) {
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
      if (DIGEST_RE.test(out)) return out;
      if (name === 'manifest') {
        // manifest inspect --verbose 输出 JSON，取顶层 Descriptor.digest
        const parsed = JSON.parse(out);
        const digest = Array.isArray(parsed)
          ? parsed[0]?.Descriptor?.digest
          : parsed?.Descriptor?.digest;
        if (typeof digest === 'string' && DIGEST_RE.test(digest)) return digest;
      }
    } catch {
      /* 尝试下一种方式 */
    }
  }
  return null;
}

/** 把 `node:22-alpine` 拆成 registry 路径（Docker Hub 的官方镜像带 library/ 前缀）。 */
function splitImage(image) {
  const at = image.indexOf('@');
  const withoutDigest = at >= 0 ? image.slice(0, at) : image;
  const colon = withoutDigest.lastIndexOf(':');
  const name = colon >= 0 ? withoutDigest.slice(0, colon) : withoutDigest;
  const tag = colon >= 0 ? withoutDigest.slice(colon + 1) : 'latest';
  const repo = name.includes('/') ? name : `library/${name}`;
  return { repo, tag };
}

/**
 * 走 Registry HTTP API 解析 digest（无需 docker）。
 *
 * 关键点：必须带 index/manifest list 的 Accept 头，否则 registry 会回退到
 * schema v1 单架构 manifest——那是**另一个** digest，pin 上去与 docker buildx
 * 解析出的结果不一致。
 */
async function resolveDigestViaRegistry(image) {
  const { repo, tag } = splitImage(image);
  const scope = `repository:${repo}:pull`;

  const tokenUrl = `${TOKEN_URL}?service=${encodeURIComponent(SERVICE)}&scope=${encodeURIComponent(scope)}`;
  const tokenRes = await fetch(tokenUrl, { signal: AbortSignal.timeout(30_000) });
  if (!tokenRes.ok) {
    throw new Error(`token 端点返回 ${tokenRes.status}：${tokenUrl}`);
  }
  const tokenJson = await tokenRes.json();
  const token = tokenJson.token ?? tokenJson.access_token;
  if (!token) throw new Error(`token 端点未返回 token：${tokenUrl}`);

  const manifestUrl = `${REGISTRY.replace(/\/$/, '')}/v2/${repo}/manifests/${tag}`;
  const manifestRes = await fetch(manifestUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: [
        'application/vnd.oci.image.index.v1+json',
        'application/vnd.docker.distribution.manifest.list.v2+json',
        'application/vnd.oci.image.manifest.v1+json',
        'application/vnd.docker.distribution.manifest.v2+json',
      ].join(','),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!manifestRes.ok) {
    throw new Error(`manifest 请求返回 ${manifestRes.status}：${manifestUrl}`);
  }
  const digest = manifestRes.headers.get('docker-content-digest');
  if (!digest || !DIGEST_RE.test(digest)) {
    throw new Error(`响应头缺 Docker-Content-Digest：${manifestUrl}`);
  }
  return digest;
}

/** 先 docker，后 Registry API。 */
async function resolveDigest(image) {
  const viaDocker = resolveDigestViaDocker(image);
  if (viaDocker) return { digest: viaDocker, via: 'docker' };

  const viaRegistry = await resolveDigestViaRegistry(image);
  return { digest: viaRegistry, via: 'registry-api' };
}

const digests = new Map();
for (const image of IMAGES) {
  let resolved;
  try {
    resolved = await resolveDigest(image);
  } catch (err) {
    throw new Error(
      `无法解析 ${image} 的 digest（${err.message}）。\n` +
        '  · 有 docker 时：确认 docker 可用且能访问镜像仓库（docker login / 代理）\n' +
        '  · 无 docker 时：确认能访问 registry（国内网络可设 DUSTNOTE_DOCKER_REGISTRY / ' +
        'DUSTNOTE_DOCKER_TOKEN_URL 指向镜像源）\n' +
        '  · 或临时保留浮动 tag（不安全但可用）。'
    );
  }
  digests.set(image, resolved.digest);
  console.log(`✓ ${image} → ${resolved.digest}  [${resolved.via}]`);
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
