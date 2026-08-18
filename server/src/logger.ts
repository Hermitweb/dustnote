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
      // 口令与密钥派生产物
      'password',
      'masterPassword',
      'authKey',
      'recoveryAuthKey',
      'masterKey',
      'masterSalt',
      'master_salt',
      'pw_salt',
      'rc_salt',
      'auth_hash',
      'recovery_auth_hash',
      'recovery_hash',
      'recovery_salt',
      'password_hash',
      'wrapped_master_key',
      'wrappedMasterKey',
      // 会话令牌
      'token',
      'refreshToken',
      'refresh_token',
      'refresh_token_hash',
      'accessToken',
      'secret',
      'shareKey',
      'wrapped_share_key',
      '*.token',
      '*.ciphertext',
      '*.password',
      '*.masterKey',
      '*.authKey',
      '*.secret',
      '*.refresh_token_hash',
      '*.password_hash',
      '*.auth_hash',
      '*.recovery_hash',
      // §3.1 红线：日志中绝不出现明文笔记内容、附件原始名、分享密码明文
      'content',
      'title',
      'note',
      'noteContent',
      'attachmentFilename',
      'attachment_filename',
      '*.content',
      '*.title',
      '*.note',
      '*.noteContent',
      '*.attachment_filename',
    ],
    censor: '[REDACTED]',
  },
});
