#!/usr/bin/env bash
# 告警链路演练（roadmap P0-2 验收标准：主动拔容器 → 2 分钟内收到告警）
#
# 在服务器 root 下执行。流程：
#   1. 停主栈 → 轮询 Prometheus，等 DustnoteEndpointDown 进入 firing
#      （规则 for: 2m，理论最长 ~2.5 分钟，脚本上限 4 分钟）
#   2. 恢复主栈 → 等 up 恢复 + Prometheus resolved
#   3. 打印演练结论（手机 ntfy 应各收到一条 🔴 与 ✅；没收到 = 链路有断点，
#      按 monitoring/README「排查」处理）
#
# 依赖：curl；Prometheus 面板 127.0.0.1:9090（监控栈已运行）。
set -euo pipefail

PROM='http://127.0.0.1:9090'
MAIN_DIR="${MAIN_DIR:-$(ls -d /opt/dustnote-server-v* 2>/dev/null | sort -V | tail -1)}"
[ -n "$MAIN_DIR" ] || { echo "[FAIL] 找不到主栈目录（或显式 MAIN_DIR=/opt/dustnote-server-vX.Y.Z $0）"; exit 1; }
[ -d "$MAIN_DIR" ] || { echo "[FAIL] MAIN_DIR 不存在: $MAIN_DIR"; exit 1; }

alert_state() {
  curl -sf "$PROM/api/v1/alerts" \
    | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    for a in d.get('data',{}).get('alerts',[]):
        if a.get('labels',{}).get('alertname')=='DustnoteEndpointDown':
            print(a.get('state'))
            break
except Exception:
    pass
"
}

echo "== 演练开始 $(date -u +%FT%TZ) | 主栈: $MAIN_DIR =="
[ "$(alert_state)" = "firing" ] && { echo "[SKIP-PROTECT] DustnoteEndpointDown 已在 firing——服务当前真宕机？先处理再演练"; exit 1; }

echo "[1/4] 停止主栈（docker compose down）..."
cd "$MAIN_DIR" && docker compose down >/dev/null 2>&1

echo "[2/4] 等待告警 firing（规则 for 2m，上限 240s）..."
FIRED=0
for i in $(seq 1 48); do
  sleep 5
  S=$(alert_state)
  if [ "$S" = "firing" ]; then FIRED=1; echo "  firing 用时 $((i*5))s"; break; fi
done

echo "[3/4] 恢复主栈..."
docker compose up -d >/dev/null 2>&1

echo "[4/4] 等待服务恢复 + 告警 resolved..."
HEALTH=0
for i in $(seq 1 24); do
  sleep 5
  V=$(curl -sf "http://127.0.0.1:8080/api/v1/health" 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin).get('version',''))" 2>/dev/null || true)
  if [ -n "$V" ]; then HEALTH=1; echo "  服务恢复 version=$V（用时 $((i*5))s）"; break; fi
done
RESOLVED=0
for i in $(seq 1 24); do
  sleep 10
  [ "$(alert_state)" = "" ] && { RESOLVED=1; break; }
done

echo "== 结果 =="
[ "$FIRED" = 1 ] && echo "  ✓ 宕机 → firing（≤240s）" || echo "  ✗ 未观测到 firing（检查 rules.yml 加载 / prometheus targets）"
[ "$HEALTH" = 1 ] && echo "  ✓ 主栈已恢复" || echo "  ✗ 主栈未恢复！立即人工检查：cd $MAIN_DIR && docker compose up -d && docker logs dustnote"
[ "$RESOLVED" = 1 ] && echo "  ✓ resolved 完成（alertmanager 应推了恢复通知）" || echo "  ⚠ 未确认 resolved（可能仍在 repeat 窗口内，手机确认 ✅ 通知）"
[ "$FIRED" = 1 ] && [ "$HEALTH" = 1 ] && echo "DRILL_PASS" || echo "DRILL_FAIL"
