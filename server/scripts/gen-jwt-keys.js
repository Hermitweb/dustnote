#!/usr/bin/env node
/**
 * 生成 EdDSA (Ed25519) JWT 签名密钥对。
 *
 * 用法：
 *   node server/scripts/gen-jwt-keys.js
 *   node server/scripts/gen-jwt-keys.js --env           # 输出 .env 格式
 *   node server/scripts/gen-jwt-keys.js --file ./keys  # 写入文件到指定目录
 *
 * 安全：
 *   - 私钥（JWT_PRIVATE_KEY）只在服务端使用，切勿泄露或提交到 git
 *   - 公钥（JWT_PUBLIC_KEY）可分发给客户端/网关用于离线验签
 */

import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const asEnv = args.includes('--env');
const fileIdx = args.indexOf('--file');
const fileDir = fileIdx !== -1 ? args[fileIdx + 1] : null;

// 生成 Ed25519 密钥对
const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
});

const privatePem = privateKey.trim();
const publicPem = publicKey.trim();

if (fileDir) {
  mkdirSync(fileDir, { recursive: true });
  writeFileSync(resolve(fileDir, 'jwt-private.pem'), privatePem + '\n', { mode: 0o600 });
  writeFileSync(resolve(fileDir, 'jwt-public.pem'), publicPem + '\n');
  console.log(`✓ 私钥已写入 ${resolve(fileDir, 'jwt-private.pem')} (权限 600)`);
  console.log(`✓ 公钥已写入 ${resolve(fileDir, 'jwt-public.pem')}`);
  console.log('\n将以下内容加入 .env：');
  console.log(`JWT_PRIVATE_KEY=${privatePem.replace(/\n/g, '\\n')}`);
  console.log(`JWT_PUBLIC_KEY=${publicPem.replace(/\n/g, '\\n')}`);
} else if (asEnv) {
  console.log('JWT_PRIVATE_KEY=' + privatePem.replace(/\n/g, '\\n'));
  console.log('JWT_PUBLIC_KEY=' + publicPem.replace(/\n/g, '\\n'));
} else {
  console.log('=== JWT EdDSA (Ed25519) 密钥对 ===\n');
  console.log('--- 私钥 (JWT_PRIVATE_KEY) ---');
  console.log(privatePem);
  console.log('\n--- 公钥 (JWT_PUBLIC_KEY) ---');
  console.log(publicPem);
  console.log('\n=== 使用方式 ===');
  console.log('1. 将上方密钥复制到 .env 文件（多行用 \\n 连接为单行）');
  console.log('2. 重启服务端，启动日志会显示 "JWT 签名算法: EdDSA"');
  console.log('3. 已签发的 HS256 token 在过期前仍可验签（向后兼容）');
  console.log('\n提示：用 --file <dir> 直接写入文件，或 --env 输出 .env 格式');
}
