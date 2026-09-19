/**
 * Prometheus 指标（审计 LIFE-009）
 *
 * 默认关闭：METRICS_ENABLED=true 才暴露 /metrics；配置 METRICS_TOKEN 时
 * 要求 `Authorization: Bearer <token>`，供内网抓取器使用。
 * 标签刻意保持低基数（method/route 模板/status），绝不带 userId/deviceId。
 */
import client from 'prom-client';
import { statSync } from 'node:fs';
import { config } from './env.js';

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const httpDuration = new client.Histogram({
  name: 'dustnote_http_request_duration_seconds',
  help: 'HTTP 请求耗时（秒）',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const http5xxTotal = new client.Counter({
  name: 'dustnote_http_5xx_total',
  help: 'HTTP 5xx 响应计数',
  registers: [register],
});

export const wsConnectionsActive = new client.Gauge({
  name: 'dustnote_ws_connections_active',
  help: '当前活跃 WebSocket 连接数',
  registers: [register],
});

export const authLockoutTotal = new client.Counter({
  name: 'dustnote_auth_lockout_total',
  help: '认证失败锁定触发次数',
  registers: [register],
});

export const backupRunsTotal = new client.Counter({
  name: 'dustnote_backup_runs_total',
  help: '自动备份执行结果计数',
  labelNames: ['result'],
  registers: [register],
});

export const dbSizeBytes = new client.Gauge({
  name: 'dustnote_db_size_bytes',
  help: 'SQLite 主库文件大小（字节）',
  collect() {
    try {
      this.set(statSync(config.dbPath).size);
    } catch {
      /* 库文件尚未创建 */
    }
  },
  registers: [register],
});
