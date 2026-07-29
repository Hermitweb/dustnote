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
  jwtSecret: z.string().min(16),
  trustProxy: z.number().int().nonnegative().max(10),
});

const result = ConfigSchema.safeParse(config);
if (!result.success) {
  console.error('❌ 配置校验失败：', result.error.flatten().fieldErrors);
  process.exit(1);
}

if (config.nodeEnv === 'production') {
  if (config.jwtSecret === 'dev-secret-change-me' || config.jwtSecret.length < 32) {
    console.error('❌ 生产环境必须设置强 JWT_SECRET（≥32 字符）：openssl rand -base64 48');
    process.exit(1);
  }
}
