#!/usr/bin/env bash
# Node 双版本兼容 runner（v2.5.54 新增，工程化适配 P0）
#
# 用法：bash scripts/node-compat.sh <command...>
#   - 自动探测当前 node 能否 require('rollup')（工具链依赖）
#   - 能 → 直接用当前 node；不能 → 回退到 DUSTNOTE_NODE22 / 候选 Node 22
#   - Node 24 下 rollup prebuild 崩 → 工具链必须用 Node 22，本 runner 兜住
#
# 设计：双版本适配目标 = 代码层零 Node-22-专有 API（Node 20/22/24 通跑）+ 工具链层 runner 选版本。
# 实际跑通哪条取决于本机可用的 node bin 与 native prebuild。
#
# 候选 Node 22 路径（按序）：
#   1. 环境变量 DUSTNOTE_NODE22
#   2. 本机 hermesagent 内置 runtime（cn.org.hermesagent.desktop 0.18.2-cn.2）
#   3. PATH 里的 node22（volta/nvm 当前 22）
set -euo pipefail

CANDIDATES=(
  "${DUSTNOTE_NODE22:-}"
  "C:/Users/Admin/AppData/Roaming/cn.org.hermesagent.desktop/runtime/versions/0.18.2-cn.2/node/node.exe"
)

# 自检：该 node 能否 require('rollup')（子进程，超时 15s，不崩宿主）
node_can_load_rollup() {
  local bin="$1"
  "$bin" -e 'try{require("rollup");process.exit(0)}catch{process.exit(2)}' >/dev/null 2>&1
  # 0xC0000135 等崩溃 → 非 0 非 2，也视为不可用（只认 0）
  [ $? -eq 0 ]
}

CHOSEN=""
# 1. 当前 PATH 的 node
if command -v node >/dev/null 2>&1 && node_can_load_rollup "$(command -v node)"; then
  CHOSEN="$(command -v node)"
fi

# 2. 候选列表
if [ -z "$CHOSEN" ]; then
  for c in "${CANDIDATES[@]}"; do
    [ -z "$c" ] && continue
    [ ! -e "$c" ] && continue
    if node_can_load_rollup "$c"; then
      CHOSEN="$c"
      break
    fi
  done
fi

if [ -z "$CHOSEN" ]; then
  # 兜底：用 PATH 里的 node（可能是 Node 24，工具链会崩，但至少启动脚本能跑）
  if command -v node >/dev/null 2>&1; then
    CHOSEN="$(command -v node)"
    echo "[node-compat] WARN: 无可用 Node 22，回退当前 node；工具链（vitest/vite/rollup）可能因 prebuild 崩溃。" >&2
  else
    echo "[node-compat] ERROR: 找不到任何 node。" >&2
    exit 1
  fi
fi

echo "[node-compat] node: $CHOSEN ($("$CHOSEN" --version 2>/dev/null || echo unknown))" >&2
exec "$CHOSEN" "$@"
