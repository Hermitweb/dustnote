#!/usr/bin/env bash
# DustNote 一条命令安装部署入口（Linux / macOS）
#
# 职责：从 GitHub Release 拉取部署包 → 解压 → 调用 deploy.sh 完成部署
#       （无需先 clone 仓库，一条命令从零到上线）
#
# 用法（推荐，一条命令）：
#   curl -fsSL https://raw.githubusercontent.com/Hermitweb/dustnote/dev/setup-and-fixes/deploy/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/Hermitweb/dustnote/dev/setup-and-fixes/deploy/install.sh | bash -s -- --cn --domain notes.example.com
#
# 或下载后执行：
#   bash install.sh [--cn] [--port N] [--domain D] [--version vX.Y.Z] [--dir PATH] [--no-build]
#
# 参数：
#   --cn          中国网络加速（apk/npm/docker 均切国内镜像源）
#   --port N      宿主机端口（默认 8080）
#   --domain D    域名（设置后启用 Caddy 自动 HTTPS）
#   --version TAG 指定版本（默认自动获取 GitHub 最新 Release，如 v2.5.20）
#   --dir PATH    部署包解压目录（默认当前目录）
#   --no-build    跳过重新构建镜像（复用已构建镜像）
#   -h/--help     帮助

set -euo pipefail

REPO="Hermitweb/dustnote"
PKG_PREFIX="dustnote-server"

# ─── 颜色输出 ───
c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_blue=$'\033[36m'; c_reset=$'\033[0m'
info()  { printf '%s[INFO]%s %s\n' "$c_blue" "$c_reset" "$*"; }
ok()    { printf '%s[ OK ]%s %s\n' "$c_green" "$c_reset" "$*"; }
warn()  { printf '%s[WARN]%s %s\n' "$c_yellow" "$c_reset" "$*"; }
fail()  { printf '%s[FAIL]%s %s\n' "$c_red" "$c_reset" "$*"; exit 1; }

# ─── 参数解析 ───
CN=0
PORT="8080"
DOMAIN=""
VERSION=""
DIR=""
NO_BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cn) CN=1; shift ;;
    --port) PORT="${2:-8080}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --version) VERSION="${2:-}"; shift 2 ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    --no-build) NO_BUILD=1; shift ;;
    -h|--help)
      echo "用法：bash install.sh [--cn] [--port N] [--domain D] [--version vX.Y.Z] [--dir PATH] [--no-build]"
      echo ""
      echo "  --cn          中国网络加速（apk/npm/docker 切国内镜像源）"
      echo "  --port N      宿主机端口（默认 8080）"
      echo "  --domain D    域名（启用 Caddy 自动 HTTPS）"
      echo "  --version TAG 指定版本（默认自动获取最新 Release）"
      echo "  --dir PATH    部署包解压目录（默认当前目录）"
      echo "  --no-build    跳过重新构建镜像"
      exit 0
      ;;
    *) echo "未知参数：$1（-h 查看帮助）" >&2; exit 1 ;;
  esac
done

# ─── 依赖检查 ───
command -v curl >/dev/null 2>&1 || fail "缺少 curl，请先安装（apt/yum/brew install curl）"
command -v unzip >/dev/null 2>&1 || fail "缺少 unzip，请先安装（apt/yum/brew install unzip）"

# ─── 1. 确定版本 ───
if [[ -z "${VERSION}" ]]; then
  info "查询 GitHub 最新 Release…"
  VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
    | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"
fi
[[ -n "${VERSION}" ]] || fail "无法获取最新版本，请用 --version vX.Y.Z 指定"
[[ "${VERSION}" == v* ]] || VERSION="v${VERSION}"
info "目标版本：${VERSION}"

# ─── 2. 进入目标目录 ───
if [[ -n "${DIR}" ]]; then
  mkdir -p "${DIR}"
  cd "${DIR}"
fi

# ─── 3. 下载部署包 ───
PKG="${PKG_PREFIX}-${VERSION}.zip"
URL="https://github.com/${REPO}/releases/download/${VERSION}/${PKG}"
info "下载部署包：${PKG}"
curl -fL --retry 3 -o "${PKG}" "${URL}" || fail "下载失败：${URL}"

# ─── 4. 解压 ───
info "解压部署包…"
unzip -o -q "${PKG}" || fail "解压失败"

SRC_DIR="${PKG_PREFIX}-${VERSION}"
[[ -d "${SRC_DIR}" ]] || fail "解压目录不存在：${SRC_DIR}"

# ─── 5. 调用 deploy.sh 完成部署 ───
cd "${SRC_DIR}"
DEPLOY_ARGS=()
[[ ${CN} -eq 1 ]] && DEPLOY_ARGS+=(--cn)
[[ -n "${PORT}" ]] && DEPLOY_ARGS+=(--port "${PORT}")
[[ -n "${DOMAIN}" ]] && DEPLOY_ARGS+=(--domain "${DOMAIN}")
[[ ${NO_BUILD} -eq 1 ]] && DEPLOY_ARGS+=(--no-build)

ok "部署包已就绪：$(pwd)"
info "开始部署：bash ./deploy/deploy.sh ${DEPLOY_ARGS[*]}"
bash ./deploy/deploy.sh "${DEPLOY_ARGS[@]}"
