#!/usr/bin/env node
/**
 * compose 端口声明解析与冲突判定 —— 纯函数，门禁在 scripts/check-compose-ports.mjs。
 *
 * 事故模型（v2.5.47 → v2.5.48，2026-10-03 线上实录）：`docker-compose.yml` 的 ports
 * 里同一个容器端口被声明了两次——`${PORT_BIND:-127.0.0.1}:${PORT:-8080}:8080` 与
 * 遗留的 `${PORT:-8080}:8080`（R1 收口那次"加新忘删旧"）。两条绑定互相重叠：
 * 0.0.0.0:8080 与 127.0.0.1:8080 不能共存，容器启动时第二条必然
 * `failed to bind host port 127.0.0.1:8080/tcp: address already in use`。
 *
 * 为什么 CI 全绿也照样炸：没有任何一道检查渲染过 ports——`docker compose config`
 * 语法上完全合法，Dockerfile 构建、e2e、单测都不碰宿主端口。它只在**真部署**时现形，
 * 而那时 upgrade.sh 已经 down 掉旧容器，代价是线上中断。
 * 所以判定必须是静态的、能在本地 `pnpm verify` 里跑的。
 */

/**
 * 展开 `${VAR:-default}` 取默认值。
 * 返回 null 表示**不可判定**（纯 `${VAR}` 没有默认值，渲染结果取决于运行环境）。
 */
export function expandDefault(expr) {
  const s = String(expr).trim();
  const m = s.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}$/);
  if (!m) return s;
  return m[2] === undefined ? null : m[2];
}

/** 宿主 IP 归一：空串与 0.0.0.0 都表示"所有接口"。 */
function normalizeIp(ip) {
  const v = String(ip ?? '').trim();
  return v === '' || v === '0.0.0.0' ? '' : v;
}

const isPort = (v) => v === null || /^\d+$/.test(v);

/**
 * 按顶层 `:` 切分——`${VAR:-default}` 的默认值里就有冒号
 * （`${PORT_BIND:-127.0.0.1}` 若直接 split(':') 会被切成两段，
 * 实测就是这么把两条真绑定判成"不可解析"从而漏报的）。
 */
function splitTopLevel(spec) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i];
    if (ch === '$' && spec[i + 1] === '{') {
      depth++;
      cur += '${';
      i++;
      continue;
    }
    if (ch === '}' && depth > 0) {
      depth--;
      cur += '}';
      continue;
    }
    if (ch === ':' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

/**
 * 解析一条短语法端口声明：`c` / `h:c` / `ip:h:c`（各段可含 ${} 模板，取默认值）。
 * 返回 `{hostIp, hostPort, containerPort}`；null 表示不可静态判定
 * （变量无默认值 / 端口区间 / 形态不认识）——不可判定按"跳过"处理，
 * 但门禁会把跳过条数打出来，免得"没查"被读成"查过了没事"。
 */
export function parsePortEntry(spec) {
  const raw = String(spec)
    .trim()
    .replace(/^['"]|['"]$/g, '');
  const parts = splitTopLevel(raw);
  if (parts.length < 1 || parts.length > 3) return null;
  const exp = parts.map(expandDefault);
  if (exp.some((v) => v === null)) return null;

  let hostIp = '';
  let hostPort = null;
  let containerPort = null;
  if (parts.length === 1) {
    containerPort = exp[0];
  } else if (parts.length === 2) {
    hostPort = exp[0];
    containerPort = exp[1];
  } else {
    hostIp = normalizeIp(exp[0]);
    hostPort = exp[1];
    containerPort = exp[2];
  }
  if (!isPort(hostPort) || !isPort(containerPort)) return null;
  return {
    hostIp,
    hostPort: hostPort === null ? null : Number(hostPort),
    containerPort: containerPort === null ? null : Number(containerPort),
  };
}

/**
 * 两条绑定能否共存。判噪的三种情形：
 * - 容器端口不同 → 互不干涉；
 * - 任一侧宿主端口未指定（随机端口）→ 撞不上；
 * - 宿主端口不同 → 合法（`80:8080` + `8081:8080` 是允许的）。
 * 其余情况按冲突处理：宿主端口相同、且宿主 IP 相同或任一侧是"所有接口"。
 */
export function portsConflict(a, b) {
  if (!a || !b) return false;
  if (a.containerPort === null || b.containerPort === null) return false;
  if (a.containerPort !== b.containerPort) return false;
  if (a.hostPort === null || b.hostPort === null) return false;
  if (a.hostPort !== b.hostPort) return false;
  return a.hostIp === b.hostIp || a.hostIp === '' || b.hostIp === '';
}

/**
 * 提取 compose 文本里每个 `ports:` 列表（块式与 `[a, b]` 行内式都认）。
 * 返回 `[{ service, entries: [...原始声明串] }]`。
 *
 * 这是给本仓这一份 compose 用的小扫描器（缩进判定 + 最近的上层键当 service 名），
 * 不是通用 YAML 解析器；解析不出的声明在门禁里会被计成"跳过"并打印条数。
 */
export function extractPortGroups(composeText) {
  const lines = String(composeText).split(/\r?\n/);
  const groups = [];
  const stack = [];
  const indentOf = (s) => s.match(/^ */)[0].length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/#.*$/, '');
    if (!line.trim()) continue;
    const indent = indentOf(line);
    const trimmed = line.trim();
    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();

    const kv = trimmed.match(/^["']?([\w.-]+)["']?:\s*(.*)$/);
    if (!kv) continue;
    const [, key, rest] = kv;

    if (key === 'ports') {
      const service = stack.length ? stack[stack.length - 1].key : '(top)';
      const entries = [];
      if (rest.startsWith('[') && rest.endsWith(']')) {
        for (const item of rest.slice(1, -1).split(',')) {
          const v = item.trim();
          if (v) entries.push(v);
        }
      } else if (rest === '') {
        for (let j = i + 1; j < lines.length; j++) {
          const l2 = lines[j].replace(/#.*$/, '');
          if (!l2.trim()) continue;
          if (indentOf(l2) <= indent) break;
          const t2 = l2.trim();
          if (!t2.startsWith('-')) break;
          entries.push(t2.slice(1).trim());
        }
      }
      if (entries.length) groups.push({ service, entries });
      continue;
    }
    stack.push({ indent, key });
  }
  return groups;
}

/** 门禁主判定：返回冲突列表与跳过条数。 */
export function findPortConflicts(composeText) {
  const conflicts = [];
  let skipped = 0;
  for (const g of extractPortGroups(composeText)) {
    const parsed = g.entries.map((spec) => ({ spec, p: parsePortEntry(spec) }));
    for (const item of parsed) if (!item.p) skipped++;
    for (let a = 0; a < parsed.length; a++) {
      for (let b = a + 1; b < parsed.length; b++) {
        if (portsConflict(parsed[a].p, parsed[b].p)) {
          conflicts.push({ service: g.service, a: parsed[a].spec, b: parsed[b].spec });
        }
      }
    }
  }
  return { conflicts, skipped };
}
