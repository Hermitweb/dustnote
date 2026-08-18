/**
 * 环境变量集中导出（类型安全的 config 对象）
 */

import { join } from 'node:path';
import './config.js'; // 触发 .env 加载

function getEnv(key: string, defaultValue?: string): string {
  const v = process.env[key];
  if (v !== undefined && v !== '') return v;
  if (defaultValue !== undefined) return defaultValue;
  throw new Error(`Missing env var: ${key}`);
}

function getEnvOpt(key: string): string | undefined {
  const v = process.env[key];
  return v !== undefined && v !== '' ? v : undefined;
}

/** 开发环境默认 JWT_SECRET（仅用于本地调试，生产环境禁止使用） */
const DEFAULT_JWT_SECRET = 'dev-secret-change-me-do-not-use-in-production-32plus';

export const config = {
  nodeEnv: getEnv('NODE_ENV', 'development'),
  port: Number.parseInt(getEnv('PORT', '3210'), 10),
  logLevel: getEnv('LOG_LEVEL', 'info'),
  dbPath: getEnv('DB_PATH', './data/dustnote.db'),
  webOrigin: getEnv('WEB_ORIGIN', 'http://localhost:5173'),
  serverVersion: getEnv('SERVER_VERSION', '2.5.4'),
  minClientVersion: getEnv('MIN_CLIENT_VERSION', '2.0.2'),
  recommendedClientVersion: getEnv('RECOMMENDED_CLIENT_VERSION', '2.5.4'),
  forceUpdateVersion: getEnvOpt('FORCE_UPDATE_VERSION') ?? null,
  eolDateForV0: getEnvOpt('EOL_DATE_FOR_V0'),
  jwtSecret: getEnv('JWT_SECRET', DEFAULT_JWT_SECRET),
  /**
   * JWT 非对称签名（EdDSA / Ed25519）密钥对。
   * 配置后优先使用 EdDSA 替代 HS256：
   *   - JWT_PRIVATE_KEY：PKCS#8 PEM 格式私钥（签名用）
   *   - JWT_PUBLIC_KEY：SPKI PEM 格式公钥（验证用）
   * 用 scripts/gen-jwt-keys.js 生成密钥对。
   * 留空时回退到 JWT_SECRET (HS256)，保持向后兼容。
   */
  jwtPrivateKey: getEnvOpt('JWT_PRIVATE_KEY'),
  jwtPublicKey: getEnvOpt('JWT_PUBLIC_KEY'),
  /**
   * Express trust proxy 层数。部署在 nginx/CDN 后面必须设为反代层数（通常 1），
   * 否则 req.ip 恒等于反代自身地址，express-rate-limit 会把所有人算进同一个桶。
   * 0 = 不信任任何反代（直接暴露时用）。
   */
  trustProxy: Number.parseInt(getEnv('TRUST_PROXY', '0'), 10),
  /** Sentry DSN（留空 = 禁用错误监控；自托管部署可不填） */
  sentryDsn: getEnvOpt('SENTRY_DSN'),
  /** SQLite 自动备份目录（默认 ./backups） */
  backupDir: getEnv('BACKUP_DIR', join(process.cwd(), 'backups')),
  /** 备份保留份数（默认 30 份，按日期滚动） */
  backupRetention: Number.parseInt(getEnv('BACKUP_RETENTION', '30'), 10),
} as const;

// 生产环境强制校验 JWT_SECRET：未设置 / 使用开发默认值 / 长度不足 → 拒绝启动。
// 攻击者一旦拿到弱默认密钥即可离线伪造任意 access/refresh token，完全绕过鉴权。
// 测试与开发环境不受此约束（NODE_ENV !== 'production' 时跳过）。
if (config.nodeEnv === 'production') {
  if (config.jwtSecret === DEFAULT_JWT_SECRET) {
    throw new Error('生产环境必须设置 JWT_SECRET 环境变量（不允许使用开发默认值）');
  }
  if (config.jwtSecret.length < 32) {
    throw new Error(
      `生产环境 JWT_SECRET 长度不足（当前 ${config.jwtSecret.length} 字符，要求 ≥ 32）`,
    );
  }
}

export type AppConfig = typeof config;
