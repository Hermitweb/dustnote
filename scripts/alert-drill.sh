#!/usr/bin/env bash
# 告警链路演练与冒烟（roadmap P0-2 验收）
#
# 为什么不只是"看手机有没有收到"：那条链路的失败模式是静默的 ——
# Alertmanager 路由写错、bridge 的 topic 填错、ntfy 不可达，都只体现在
# 容器日志里；而旧 bridge 无论成败都回 200，Alertmanager 认为已送达不再重试。
# 所以这里把**最后一跳**变成断言：读 bridge 的 /stats，比对 published 增量。
#
#   scripts/alert-drill.sh            # 全量演练：主动拔主栈，等 firing→resolved（约 5 分钟，期间服务不可用）
#   scripts/alert-drill.sh --smoke    # 冒烟：只投一条合成告警走完整链路，不动主栈（推荐日常/CI 后跑）
#
# 依赖：curl、python3、docker compose（监控栈已运行）。
set -euo pipefail

PROM='http://127.0.0.1:9090'
AM='http://127.0.0.1:9093'
MON_DIR="${MON_DIR:-$(cd "$(dirname "$0")/../deploy/monitoring" && pwd)}"
MAIN_DIR="${MAIN_DIR:-$(ls -d /opt/dustnote-server-v* 2>/dev/null | sort -V | tail -1)}"
SMOKE=0
[ "${1:-}" = "--smoke" ] && SMOKE=1

# bridge 没有对外发布端口（只在内网），所以经容器内 wget 读它的 /stats
bridge_stat() {
  docker compose -f "$MON_DIR/compose.monitoring.yml" exec -T ntfy-bridge \
    wget -qO- http://127.0.0.1:9095/stats 2>/dev/null || true
}
bridge_field() {
  bridge_stat | python3 -c "import json,sys
try: print(json.load(sys.stdin).get('$1', 0))
except Exception: print(0)"
}

alert_state() {
  curl -sf "$PROM/api/v1/alerts" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    for a in d.get('data',{}).get('alerts',[]):
        if a.get('labels',{}).get('alertname')==='$1':
            print(a.get('state')); break
except Exception: pass
"
}

if [ "$SMOKE" = 1 ]; then
  echo "== 冒烟：向 Alertmanager 投一条合成告警，验证 AM→bridge→ntfy 全链路 =="
  [ -n "$(bridge_stat)" ] || { echo "[FAIL] 读不到 bridge /stats，监控栈没起来？cd $MON_DIR && docker compose -f compose.monitoring.yml --env-file .env.monitoring up -d"; exit 1; }
  BEFORE=$(bridge_field published)
  FAILED_BEFORE=$(bridge_field failed)
  TS=$(date -u +%H%M%S)
  curl -sf -XPOST "$AM/api/v2/alerts" -H 'content-type: application/json' -d "[{
    \"labels\": {\"alertname\": \"DrillSmokeAlert$TS\", \"severity\": \"critical\"},
    \"annotations\": {\"summary\": \"P0-2 链路冒烟（不是真故障）\", \"description\": \"看到这条 = 告警链路通\"}
  }]" >/dev/null
  echo "  已投递，等 Alertmanager group_wait(10s)+推送..."
  OK=0
  for i in $(seq 1 12); do
    sleep 5
    AFTER=$(bridge_field published)
    if [ "${AFTER:-0}" -gt "$BEFORE" ]; then OK=1; echo "  ✓ bridge 实际推送 $((AFTER-BEFORE)) 条（用时 $((i*5))s）"; break; fi
  done
  FAILED_AFTER=$(bridge_field failed)
  echo "== 结果 =="
  [ "$OK" = 1 ] && echo "  ✓ 最后一跳已送达 ntfy（手机应收到 [!!] DrillSmokeAlert$TS）" || echo "  ✗ bridge 没有成功推送（published 无增量）：查 docker compose logs ntfy-bridge，多为 NTFY_TOPIC 未订阅或 ntfy 不可达"
  [ "$FAILED_AFTER" -gt "$FAILED_BEFORE" ] && echo "  ⚠ 期间有 $((FAILED_AFTER-FAILED_BEFORE)) 条推送失败，bridge 已回 502 让 Alertmanager 重试"
  [ "$OK" = 1 ] && echo "SMOKE_PASS" || echo "SMOKE_FAIL"
  exit $([ "$OK" = 1 ] && echo 0 || echo 1)
fi

[ -n "$MAIN_DIR" ] || { echo "[FAIL] 找不到主栈目录（或显式 MAIN_DIR=/opt/dustnote-server-vX.Y.Z $0）"; exit 1; }
[ -d "$MAIN_DIR" ] || { echo "[FAIL] MAIN_DIR 不存在: $MAIN_DIR"; exit 1; }

echo "== 演练开始 $(date -u +%FT%TZ) | 主栈: $MAIN_DIR =="
[ "$(alert_state DustnoteEndpointDown)" = "firing" ] && { echo "[SKIP-PROTECT] DustnoteEndpointDown 已在 firing——服务当前真宕机？先处理再演练"; exit 1; }
PUB_BEFORE=$(bridge_field published)

echo "[1/5] 停止主栈（docker compose down）..."
cd "$MAIN_DIR" && docker compose down >/dev/null 2>&1

echo "[2/5] 等待告警 firing（规则 for 2m，上限 240s）..."
FIRED=0
for i in $(seq 1 48); do
  sleep 5
  if [ "$(alert_state DustnoteEndpointDown)" = "firing" ]; then FIRED=1; echo "  firing 用时 $((i*5))s"; break; fi
done

echo "[3/5] 恢复主栈..."
docker compose up -d >/dev/null 2>&1

echo "[4/5] 等待服务恢复 + 告警 resolved..."
HEALTH=0
for i in $(seq 1 24); do
  sleep 5
  V=$(curl -sf "http://127.0.0.1:8080/api/v1/health" 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin).get('version',''))" 2>/dev/null || true)
  if [ -n "$V" ]; then HEALTH=1; echo "  服务恢复 version=$V（用时 $((i*5))s）"; break; fi
done
RESOLVED=0
for i in $(seq 1 24); do
  sleep 10
  [ -z "$(alert_state DustnoteEndpointDown)" ] && { RESOLVED=1; break; }
done

echo "[5/5] 核对最后一跳（bridge 是否真把通知推给 ntfy）..."
LAST_HOP=0
for i in $(seq 1 6); do
  PUB_AFTER=$(bridge_field published)
  if [ "${PUB_AFTER:-0}" -gt "${PUB_BEFORE:-0}" ]; then LAST_HOP=1; echo "  ✓ bridge 共推送 $((PUB_AFTER-PUB_BEFORE)) 条"; break; fi
  sleep 10
done

echo "== 结果 =="
[ "$FIRED" = 1 ] && echo "  ✓ 宕机 → firing（≤240s）" || echo "  ✗ 未观测到 firing（检查 rules.yml 加载 / prometheus targets）"
[ "$HEALTH" = 1 ] && echo "  ✓ 主栈已恢复" || echo "  ✗ 主栈未恢复！立即人工检查：cd $MAIN_DIR && docker compose up -d && docker logs dustnote"
[ "$RESOLVED" = 1 ] && echo "  ✓ resolved 完成" || echo "  ⚠ 未确认 resolved（可能仍在 repeat 窗口内）"
[ "$LAST_HOP" = 1 ] && echo "  ✓ 最后一跳已送达（不必靠人看手机确认）" || echo "  ✗ 最后一跳未确认：docker compose -f $MON_DIR/compose.monitoring.yml logs ntfy-bridge"
[ "$FIRED" = 1 ] && [ "$HEALTH" = 1 ] && [ "$LAST_HOP" = 1 ] && echo "DRILL_PASS" || echo "DRILL_FAIL"
