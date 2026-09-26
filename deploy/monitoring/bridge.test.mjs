/**
 * bridge 的载荷翻译与失败可见性（P0-2「真接」的验收）
 *
 * 跑法：node --test deploy/monitoring/（根脚本 pnpm test:monitoring 已接 CI）
 * 为什么值得单测：这条链路唯一的失败模式是**静默的**——topic 填错、ntfy 不可达时，
 * 老实现照样回 {"ok":true}，Alertmanager 认为已送达、永不重试，于是"有告警系统"
 * 变成"没有告警系统"，而所有人都不知道。这里把两件事钉住：
 *   1. Alertmanager 载荷 → ntfy 消息的映射（含 resolved / critical / 缺字段兜底）
 *   2. 全失败时向上返回"硬失败"，让 Alertmanager 重试
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toNtfyMessages, publishAll, stats } from './bridge.mjs';

const alert = (over = {}) => ({
  status: 'firing',
  labels: { alertname: 'DustnoteEndpointDown', severity: 'critical' },
  annotations: { summary: '端点不可达', description: 'job=dustnote' },
  ...over,
});

test('载荷翻译', () => {
  const [m] = toNtfyMessages({ alerts: [alert()] });
  assert.equal(m.alertname, 'DustnoteEndpointDown');
  assert.equal(m.priority, '5'); // critical 要响
  assert.equal(m.tags, 'rotating_light');
  assert.match(m.title, /\[!!\]/);
  assert.equal(m.message, '端点不可达\njob=dustnote');
});

test('resolved 用低优先级且标题可区分', () => {
  const [m] = toNtfyMessages({ alerts: [alert({ status: 'resolved' })] });
  assert.equal(m.resolved, true);
  assert.equal(m.priority, '3');
  assert.match(m.title, /^\[ok\] 恢复: /);
});

test('warning 优先级低于 critical', () => {
  const [m] = toNtfyMessages({
    alerts: [alert({ labels: { alertname: 'BackupStale', severity: 'warning' } })],
  });
  assert.equal(m.priority, '4');
  assert.equal(m.tags, 'warning');
});

test('缺 annotations 时回落到告警名，不产出 undefined 文案', () => {
  const [m] = toNtfyMessages({ alerts: [{ status: 'firing', labels: { alertname: 'X' } }] });
  assert.equal(m.title, '[*] X');
  assert.equal(m.message, 'X');
  assert.ok(!m.message.includes('undefined'));
});

test('畸形载荷不炸（alerts 缺失/非数组都当空批次）', () => {
  assert.deepEqual(toNtfyMessages({}), []);
  assert.deepEqual(toNtfyMessages({ alerts: 'nope' }), []);
  assert.deepEqual(toNtfyMessages(null), []);
});

test('超长 description 被截断，不会撑爆 ntfy 请求体', () => {
  const long = alert({ annotations: { summary: 's', description: 'x'.repeat(9000) } });
  const [m] = toNtfyMessages({ alerts: [long] });
  assert.ok(m.message.length <= 4096);
});

test('全部推送失败 → 报告零送达（调用方据此回 502 让 Alertmanager 重试）', async () => {
  const real = global.fetch;
  const before = stats.failed;
  global.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  try {
    const r = await publishAll({
      alerts: [alert(), alert({ labels: { alertname: 'B', severity: 'warning' } })],
    });
    assert.equal(r.attempted, 2);
    assert.equal(r.ok, 0);
    assert.ok(stats.failed > before, 'failed 计数必须增长');
    assert.match(stats.lastError, /B: |DustnoteEndpointDown: /);
  } finally {
    global.fetch = real;
  }
});

test('部分成功也如实报告条数（不夸大送达）', async () => {
  const real = global.fetch;
  let n = 0;
  global.fetch = async () => {
    n += 1;
    return n === 1
      ? { ok: true, status: 200, text: async () => '' }
      : { ok: false, status: 502, text: async () => 'x' };
  };
  try {
    const r = await publishAll({
      alerts: [alert(), alert({ labels: { alertname: 'C', severity: 'warning' } })],
    });
    assert.equal(r.attempted, 2);
    assert.equal(r.ok, 1);
  } finally {
    global.fetch = real;
  }
});

test('空批次不算失败（Alertmanager 会发空通知表示全部恢复）', async () => {
  const real = global.fetch;
  let called = 0;
  global.fetch = async () => {
    called += 1;
    return { ok: true, status: 200, text: async () => '' };
  };
  try {
    const r = await publishAll({ alerts: [] });
    assert.equal(r.attempted, 0);
    assert.equal(r.ok, 0);
    assert.equal(called, 0);
  } finally {
    global.fetch = real;
  }
});
