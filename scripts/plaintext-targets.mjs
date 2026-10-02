#!/usr/bin/env node
/**
 * 明文收口的目标端口与判定 —— 单独成模块的原因：
 * `status-probe.mjs` 是一路 top-level await 跑到底的脚本，import 它就会真的发请求、
 * 还会写 docs/status.md。测试要断言的只是这两条纯函数，不该为此拖进副作用。
 */

/**
 * 明文收口要探哪些端口。
 *
 * 只探 80 是不够的：容器把 8080 直接发布到公网，那条路径绕过前置代理，由容器内 nginx
 * 自己应答。收口必须两处都做（前置 301 + 不再公网发布 8080），探针也才给得出诚实结论。
 */
export function plaintextTargets(urlBase) {
  const u = new URL(urlBase);
  const out = [
    { label: u.port || '80', url: 'http://' + u.hostname + (u.port ? ':' + u.port : '') },
  ];
  if (!u.port) out.push({ label: '8080', url: 'http://' + u.hostname + ':8080' });
  return out;
}

/** 单个端口的收口结论。3xx 与 404 都算收口：前者是期望形态，后者是根本没在监听。 */
export function plaintextVerdict(status) {
  const hardened = [301, 302, 307, 308].includes(status) || status === 404;
  return {
    hardened,
    note: hardened
      ? '明文已收口（status=' + status + '）'
      : '明文仍可服务（status=' + status + '，R1 HTTPS 收口已漏）',
  };
}

/**
 * 连不上 = 该端口根本没对外发布，比 301 更彻底，判收口。
 *
 * 但只把"连接层失败"当不可达：HTTP 4xx/5xx 是有服务在应答，那必须走 plaintextVerdict
 * 分类，不能在这里刷绿——否则一个回了 400 的明文服务会被读成"没在监听"。
 */
export function plaintextUnreachable(errMessage) {
  const m = String(errMessage ?? '').slice(0, 80);
  return { hardened: true, note: '明文不可达（该端口未对外发布）：' + m };
}
