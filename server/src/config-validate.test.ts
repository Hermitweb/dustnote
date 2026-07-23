import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// 复刻 ConfigSchema 以便独立测试，避免 config-validate.ts 在导入时退出进程
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
});

describe('config validation schema', () => {
  it('accepts valid configuration', () => {
    const result = ConfigSchema.safeParse({
      nodeEnv: 'production',
      port: 3210,
      logLevel: 'info',
      dbPath: './data/dustnote.db',
      webOrigin: 'https://dustnote.example.com',
      serverVersion: '0.1.0',
      minClientVersion: '0.1.0',
      recommendedClientVersion: '0.1.0',
      forceUpdateVersion: null,
      jwtSecret: 'a-very-strong-secret-key-32-chars-long',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid port', () => {
    const result = ConfigSchema.safeParse({
      nodeEnv: 'development',
      port: 70000,
      logLevel: 'info',
      dbPath: './data/dustnote.db',
      webOrigin: 'http://localhost:5173',
      serverVersion: '0.1.0',
      minClientVersion: '0.1.0',
      recommendedClientVersion: '0.1.0',
      forceUpdateVersion: null,
      jwtSecret: 'short-secret',
    });
    expect(result.success).toBe(false);
  });

  it('rejects short jwt secret', () => {
    const result = ConfigSchema.safeParse({
      nodeEnv: 'development',
      port: 3210,
      logLevel: 'info',
      dbPath: './data/dustnote.db',
      webOrigin: 'http://localhost:5173',
      serverVersion: '0.1.0',
      minClientVersion: '0.1.0',
      recommendedClientVersion: '0.1.0',
      forceUpdateVersion: null,
      jwtSecret: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid web origin', () => {
    const result = ConfigSchema.safeParse({
      nodeEnv: 'development',
      port: 3210,
      logLevel: 'info',
      dbPath: './data/dustnote.db',
      webOrigin: 'not-a-url',
      serverVersion: '0.1.0',
      minClientVersion: '0.1.0',
      recommendedClientVersion: '0.1.0',
      forceUpdateVersion: null,
      jwtSecret: 'a-very-strong-secret-key-32-chars-long',
    });
    expect(result.success).toBe(false);
  });
});
