#!/usr/bin/env bash
# DustNote 一键部署脚本（Linux 全发行版 + macOS）
#
# 用法：
#   ./deploy/deploy.sh                 # 默认 HTTP 模式（8080 端口）
#   ./deploy/deploy.sh --cn            # 中国网络：使用 Aliyun/npmmirror 镜像源
#   ./deploy/deploy.sh --domain notes.example.com   # 启用 HTTPS（Caddy 自动证书）
#   ./deploy/deploy.sh --port 9000 --domain notes.example.com
#
# 参数：
#   --cn          中国网络加速（apk/npm/docker 均切国内镜像源）
#   --port N      宿主机端口（默认 8080）
#   --domain D    域名（设置后启用 Caddy 自动证书）
#   --origin URL  覆盖 WEB_ORIGIN/CORS 白名单（默认 http://<本机IP>:<端口>）
#   --no-build    跳过重新构建镜像（复用已构建镜像）
#   -h/--help     帮助

set -euo pipefail

# ─── 定位仓库根目录 ───
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

# ─── 参数解析 ───
CN=0
PORT="8080"
DOMAIN=""
ORIGIN=""
NO_BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cn) CN=1; shift ;;
    --port) PORT="${2:-8080}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --origin) ORIGIN="${2:-}"; shift 2 ;;
    --no-build) NO_BUILD=1; shift ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数：$1（-h 查看帮助）" >&2; exit 1 ;;
  esac
done

# ─── 颜色输出 ───
c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_blue=$'\033[36m'; c_reset=$'\033[0m'
info()  { printf '%s[INFO]%s %s\n' "$c_blue" "$c_reset" "$*"; }
ok()    { printf '%s[ OK ]%s %s\n' "$c_green" "$c_reset" "$*"; }
warn()  { printf '%s[WARN]%s %s\n' "$c_yellow" "$c_reset" "$*"; }
fail()  { printf '%s[FAIL]%s %s\n' "$c_red" "$c_reset" "$*"; exit 1; }

# ─── 检测操作系统 ───
OS="$(uname -s)"
DISTRO=""
case "${OS}" in
  Darwin) DISTRO="macos" ;;
  Linux)
    if [[ -f /etc/os-release ]]; then
      . /etc/os-release
      DISTRO="${ID:-unknown}"
    else
      DISTRO="unknown"
    fi
    ;;
  *) fail "不支持的操作系统：${OS}" ;;
esac
info "检测到操作系统：${OS}${DISTRO:+（${DISTRO}）}"

# ─── 检测/安装 Docker ───
need_docker=0
command -v docker >/dev/null 2>&1 || need_docker=1
if [[ ${need_docker} -eq 0 ]]; then
  docker info >/dev/null 2>&1 || need_docker=1
fi

if [[ ${need_docker} -eq 1 ]]; then
  info "未检测到可用 Docker，开始安装…"
  case "${DISTRO}" in
    macos)
      if command -v brew >/dev/null 2>&1; then
        info "通过 Homebrew 安装 Docker Desktop…"
        brew install --cask docker || fail "Docker Desktop 安装失败"
        warn "请启动 Docker Desktop 并完成首次初始化后，重新运行本脚本。"
        exit 0
      else
        fail "macOS 未安装 Docker。请先安装 Docker Desktop（https://www.docker.com/products/docker-desktop/），或安装 Homebrew 后重试。"
      fi
      ;;
    ubuntu|debian|centos|rhel|fedora|rocky|almalinux|raspbian|linuxmint|pop|elementary|kali|opensuse-leap|opensuse-tumbleweed|sles)
      get_docker_url="https://get.docker.com"
      mirror_arg=""
      if [[ ${CN} -eq 1 ]]; then mirror_arg="--mirror Aliyun"; fi
      info "下载 Docker 官方安装脚本（get.docker.com）…"
      curl -fsSL "${get_docker_url}" -o /tmp/get-docker.sh || fail "下载安装脚本失败"
      # shellcheck disable=SC2086
      sh /tmp/get-docker.sh ${mirror_arg} || fail "Docker 安装失败（可能需要 root/sudo 权限）"
      rm -f /tmp/get-docker.sh
      ;;
    *)
      fail "无法自动安装 Docker（发行版：${DISTRO}）。请手动安装 Docker 24+ 与 Compose v2 后重试。"
      ;;
  esac
fi

# ─── 检测 Docker Compose v2 ───
compose_cmd=""
if docker compose version >/dev/null 2>&1; then
  compose_cmd="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  compose_cmd="docker-compose"
else
  fail "未检测到 Docker Compose v2，请安装后重试（https://docs.docker.com/compose/install/）"
fi
ok "Docker：$(docker --version) / Compose：$(${compose_cmd} version --short 2>/dev/null || echo v2)"

# ─── 中国网络：配置 Docker 镜像加速 ───
if [[ ${CN} -eq 1 ]]; then
  daemon_json="/etc/docker/daemon.json"
  if [[ -w "${daemon_json}" || -w /etc/docker ]]; then
    if [[ -f "${daemon_json}" ]] && grep -q "registry-mirrors" "${daemon_json}" 2>/dev/null; then
      info "daemon.json 已存在 registry-mirrors，跳过镜像加速"
    else
      info "写入 Docker 镜像加速（docker.1panel.live）…"
      mkdir -p /etc/docker
      # 文件不存在才写，已存在则仅提示（避免覆盖用户自定义项）
      if [[ ! -f "${daemon_json}" ]]; then
        printf '{\n  "registry-mirrors": ["https://docker.1panel.live"]\n}\n' > "${daemon_json}" 2>/dev/null \
          || warn "无法写入 daemon.json，跳过镜像加速（不影响构建，仅拉取慢）"
        systemctl restart docker 2>/dev/null || service docker restart 2>/dev/null || warn "无法重启 docker 服务（可能需要 sudo）"
      else
        warn "daemon.json 已存在但无 registry-mirrors，请手动添加（避免覆盖现有配置）"
      fi
    fi
  else
    warn "无权限写入 /etc/docker/daemon.json，跳过镜像加速（可用 sudo 重新运行）"
  fi
fi

# ─── 生成 .env ───
if [[ -f .env ]]; then
  info "检测到已存在 .env，跳过生成（如需重置请删除后重跑）"
else
  info "生成 .env 配置…"
  VERSION="$(grep -m1 '"version"' package.json 2>/dev/null | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || echo "2.5.24")"
  [[ -n "${VERSION}" ]] || VERSION="2.5.24"
  JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"

  # 服务器 IP（默认路由源地址）：用于 WEB_ORIGIN 推导与最终访问地址输出
  LAN_IP="$(ip route get 1 2>/dev/null | awk '{print $7; exit}' || hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost')"
  [[ -z "${LAN_IP}" ]] && LAN_IP="localhost"

  # WEB_ORIGIN（CORS 白名单）：域名 > --origin > http://<IP>:<PORT>
  if [[ -n "${DOMAIN}" ]]; then
    WEB_ORIGIN="https://${DOMAIN}"
  elif [[ -n "${ORIGIN}" ]]; then
    WEB_ORIGIN="${ORIGIN}"
  else
    WEB_ORIGIN="http://${LAN_IP}:${PORT}"
  fi

  cat > .env <<EOF
# DustNote 环境变量（由 deploy.sh 自动生成 $(date +%F)）
PORT=${PORT}
WEB_ORIGIN=${WEB_ORIGIN}
SERVER_VERSION=${VERSION}
MIN_CLIENT_VERSION=2.0.2
RECOMMENDED_CLIENT_VERSION=${VERSION}
FORCE_UPDATE_VERSION=
EOL_DATE_FOR_V0=
JWT_SECRET=${JWT_SECRET}
TRUST_PROXY=1
LOG_LEVEL=info
EOF
  [[ -n "${DOMAIN}" ]] && echo "DOMAIN=${DOMAIN}" >> .env
  ok ".env 已生成（JWT_SECRET 已随机化，请妥善保存）"
fi

# ─── 构建参数（中国网络） ───
if [[ ${CN} -eq 1 ]]; then
  export APK_MIRROR="mirrors.aliyun.com"
  export NPM_REGISTRY="https://registry.npmmirror.com"
  info "已启用中国镜像源：apk=mirrors.aliyun.com / npm=npmmirror"
fi

# ─── 启动 ───
info "启动容器…"
BUILD_LOG="/tmp/dustnote-compose-build.log"
BUILD_OPTS=()
[[ ${NO_BUILD} -eq 1 ]] || BUILD_OPTS+=(--build)
# 构建输出重定向到日志文件，避免淹没脚本的关键信息；失败时回显尾部
if [[ -n "${DOMAIN}" ]]; then
  ok "启用 HTTPS 模式（Caddy 自动证书，域名：${DOMAIN}）"
  ${compose_cmd} --profile tls up -d "${BUILD_OPTS[@]}" > "${BUILD_LOG}" 2>&1 || { tail -40 "${BUILD_LOG}" >&2; fail "docker compose up 失败，完整构建日志：${BUILD_LOG}"; }
else
  ${compose_cmd} up -d "${BUILD_OPTS[@]}" > "${BUILD_LOG}" 2>&1 || { tail -40 "${BUILD_LOG}" >&2; fail "docker compose up 失败，完整构建日志：${BUILD_LOG}"; }
fi

# ─── 等待健康检查 ───
info "等待服务健康检查通过（最长 120s）…"
HEALTHY=0
for _ in $(seq 1 40); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' dustnote 2>/dev/null || echo '')"
  if [[ "${status}" == "healthy" ]]; then HEALTHY=1; break; fi
  if [[ "${status}" == "unhealthy" ]]; then break; fi
  sleep 3
done

if [[ ${HEALTHY} -eq 1 ]]; then
  ok "服务已就绪"
else
  warn "健康检查未通过，查看日志：${compose_cmd} logs dustnote"
fi

# ─── 输出访问地址 ───
if [[ -n "${DOMAIN}" ]]; then
  info "访问地址：https://${DOMAIN}"
else
  # 默认路由源地址：本机为公网 IP 时即公网地址，局域网部署时即内网地址
  info "访问地址：http://${LAN_IP}:${PORT}（本机/局域网/公网按实际网络位置访问）"
fi
info "提示：Docker 发布的端口不受 ufw/iptables INPUT 规则限制，如需限制来源请改 compose 端口绑定或在 DOCKER-USER 链配置"
ok "部署完成。常用命令：${compose_cmd} logs -f dustnote / ${compose_cmd} down"
