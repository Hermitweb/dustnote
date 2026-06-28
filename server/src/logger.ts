/**
 * 结构化日志（pino）
 */

import pino from 'pino';
import { config } from './env.js';

export const logger = pino({
  level: config.logLevel,
  // 生产环境 JSON，开发环境 pretty
  ...(config.nodeEnv === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : {}),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'masterPassword',
      'token',
      '*.token',
      '*.ciphertext',
    ],
    censor: '[REDACTED]',
  },
});
