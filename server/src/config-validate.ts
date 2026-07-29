/**
 * 配置校验：启动时 fail-fast，避免运行时才发现配置错误
 */

import { z } from 'zod';
import { config } from './env.js';

const ConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']),
  port: z.number().int().positive().max(65535),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']),
  dbPath: z.string().min(1),
  webOrigin: z.string().url(),
  serverVersion: z.string().regex(/^\d+\.\d+\.\d+/),
  minClientVersion: z.string().regex(/^\d+\.\d+\.\d+/),
  recommendedClientVersion: z.string().regex(/^\d+\.\d+\.\d+/),
  forceUpdateVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+/)
    .nullable(),
  eolDateForV0: z.string().optional(),
  jwtSecret: z.string().min(32, 'JWT_SECRET 必须 ≥32 字符'),
  trustProxy: z.number().int().nonnegative().max(10),
});

const result = ConfigSchema.safeParse(config);
if (!result.success) {
  console.error('❌ 配置校验失败：', result.error.flatten().fieldErrors);
  process.exit(1);
}

// 已知的弱默认值（开发便利），生产环境必须拒绝
const KNOWN_WEAK_DEFAULTS = new Set([
  'dev-secret-change-me-do-not-use-in-production-32plus',
]);

// 生产环境额外拒绝已知弱默认值；开发/test 环境仅警告
if (config.nodeEnv === 'production') {
  if (KNOWN_WEAK_DEFAULTS.has(config.jwtSecret)) {
    console.error('❌ 生产环境禁止使用默认 JWT_SECRET：openssl rand -base64 48');
    process.exit(1);
  }
} else if (config.nodeEnv !== 'test') {
  if (KNOWN_WEAK_DEFAULTS.has(config.jwtSecret)) {
    console.warn('⚠️  正在使用默认 JWT_SECRET，请勿用于对外暴露的开发环境：export JWT_SECRET="$(openssl rand -base64 48)"');
  }
}
