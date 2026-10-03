/**
 * compose 端口冲突判定的回归测试（跑法：pnpm test:monitoring）
 *
 * 为什么必须有：v2.5.47 随包发布的 docker-compose.yml 里 8080 被声明了两次
 * （回环 + 所有接口），容器 up 必定失败；CI 全绿、e2e 全绿、upgrade.sh 现场才炸。
 * 这类"只有真部署才现形"的缺陷，必须有能在本地跑的静态判定 + 断言钉住。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parsePortEntry,
  portsConflict,
  extractPortGroups,
  findPortConflicts,
} from './compose-ports.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('parsePortEntry：三种语法形态与 ${VAR:-default} 展开', () => {
  assert.deepEqual(parsePortEntry("'${PORT_BIND:-127.0.0.1}:${PORT:-8080}:8080'"), {
    hostIp: '127.0.0.1',
    hostPort: 8080,
    containerPort: 8080,
  });
  assert.deepEqual(parsePortEntry("'${PORT:-8080}:8080'"), {
    hostIp: '',
    hostPort: 8080,
    containerPort: 8080,
  });
  assert.deepEqual(parsePortEntry('127.0.0.1:8080:8080'), {
    hostIp: '127.0.0.1',
    hostPort: 8080,
    containerPort: 8080,
  });
  assert.deepEqual(parsePortEntry('80:80'), { hostIp: '', hostPort: 80, containerPort: 80 });
  assert.deepEqual(parsePortEntry('8080'), { hostIp: '', hostPort: null, containerPort: 8080 });
});

test('parsePortEntry：不可静态判定的形态返回 null（跳过而不是猜）', () => {
  assert.equal(parsePortEntry("'${PORT}:8080'"), null, '无默认值的变量 → 运行环境决定');
  assert.equal(parsePortEntry("'${PORT_BIND:-127.0.0.1}:8080-8090:8080'"), null, '端口区间不认识');
  assert.equal(parsePortEntry('ip:host:container:extra'), null, '四段形态不认识');
});

test('portsConflict：v2.5.47 那对绑定必须判为冲突', () => {
  const loopback = parsePortEntry("'${PORT_BIND:-127.0.0.1}:${PORT:-8080}:8080'");
  const allIfaces = parsePortEntry("'${PORT:-8080}:8080'");
  assert.equal(portsConflict(loopback, allIfaces), true, '0.0.0.0:8080 与 127.0.0.1:8080 不能共存');
  assert.equal(portsConflict(allIfaces, loopback), true, '判定与左右顺序无关');
});

test('portsConflict：合法组合不得误报', () => {
  const a = parsePortEntry('127.0.0.1:8080:8080');
  assert.equal(portsConflict(a, parsePortEntry('10.0.0.1:8080:8080')), false, '不同宿主 IP 可共存');
  assert.equal(
    portsConflict(a, parsePortEntry('80:8080')),
    false,
    '不同宿主端口可共存（一容器端口多宿主端口）'
  );
  assert.equal(
    portsConflict(a, parsePortEntry('127.0.0.1:8080:3210')),
    false,
    '不同容器端口互不干涉'
  );
  assert.equal(portsConflict(a, parsePortEntry('8080')), false, '宿主端口随机分配撞不上');
  assert.equal(portsConflict(a, null), false, '不可判定的一侧不参与判定');
});

test('extractPortGroups：块式/行内式/注释/多 service 都认，service 名取上层键', () => {
  const fixture = [
    'services:',
    '  dustnote:',
    '    image: dustnote:latest',
    '    ports:',
    '      # 注释行不算条目',
    "      - '${PORT_BIND:-127.0.0.1}:${PORT:-8080}:8080'",
    '      - 9090:9090',
    '    volumes:',
    '      - data:/app/data',
    '  proxy:',
    '    image: nginx:alpine',
    "    ports: ['80:80', '443:443']",
  ].join('\n');
  const groups = extractPortGroups(fixture);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].service, 'dustnote');
  assert.deepEqual(groups[0].entries, [
    "'${PORT_BIND:-127.0.0.1}:${PORT:-8080}:8080'",
    '9090:9090',
  ]);
  assert.equal(groups[1].service, 'proxy');
  assert.deepEqual(groups[1].entries, ["'80:80'", "'443:443'"]);
});

test('findPortConflicts：2.5.47 的 compose 形态被抓出，且报告跳过条数', () => {
  const broken = [
    'services:',
    '  dustnote:',
    '    ports:',
    "      - '${PORT_BIND:-127.0.0.1}:${PORT:-8080}:8080'",
    "      - '${PORT:-8080}:8080'",
    "      - '${NO_DEFAULT}:9999'",
  ].join('\n');
  const { conflicts, skipped } = findPortConflicts(broken);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].service, 'dustnote');
  assert.equal(skipped, 1, '不可判定的声明要计数，避免"没查"被读成"查过了"');
});

test('仓库当前的 docker-compose.yml 无冲突绑定（门禁本体）', () => {
  const { conflicts } = findPortConflicts(readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8'));
  assert.deepEqual(conflicts, []);
});
