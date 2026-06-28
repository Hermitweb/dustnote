/**
 * 环境变量集中导出（类型安全的 config 对象）
 */

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

export const config = {
  nodeEnv: getEnv('NODE_ENV', 'development'),
  port: Number.parseInt(getEnv('PORT', '3210'), 10),
  logLevel: getEnv('LOG_LEVEL', 'info'),
  dbPath: getEnv('DB_PATH', './data/dustnote.db'),
  webOrigin: getEnv('WEB_ORIGIN', 'http://localhost:5173'),
  serverVersion: getEnv('SERVER_VERSION', '0.1.0'),
  minClientVersion: getEnv('MIN_CLIENT_VERSION', '0.1.0'),
  recommendedClientVersion: getEnv('RECOMMENDED_CLIENT_VERSION', '0.1.0'),
  forceUpdateVersion: getEnvOpt('FORCE_UPDATE_VERSION') ?? null,
  eolDateForV0: getEnvOpt('EOL_DATE_FOR_V0'),
  jwtSecret: getEnv('JWT_SECRET', 'dev-secret-change-me'),
} as const;

export type AppConfig = typeof config;
