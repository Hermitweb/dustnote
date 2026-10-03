#!/usr/bin/env bash
#
# DustNote 服务器版本升级（自托管单节点，Debian + Docker Compose）
#
# 用法（在服务器 root 下执行，或经宝塔面板下发）：
#   bash upgrade.sh <新版本号>            # 版本号见 GitHub Release tags
#   SKIP_DOWNLOADS=1 bash upgrade.sh ...  # 跳过 downloads 三件套同步
#
# 设计目标=把发版实录中踩过的坑全部程序化规避：
#   1. 「down 错目录」事故（v2.5.42 曾在旧版目录 down,项目名不匹配导致
#      旧容器继续跑、health 版本不更新）——本脚本用运行中容器的 compose
#      label 反查**实际目录与项目名**,不做名字猜谜;
#   2. 「create 撞 container_name」——先 build（不占名）→ down 旧 → create
#      （镜像就绪,秒级建容器）→ 迁卷 → up,停机窗口压到 1 分钟内;
#   3. 卷迁移 chown 1001 漏做导致 SQLITE_CANTOPEN 历史事故;
#   4. downloads 产物 chmod 644 漏做导致 manifest 读 hash EACCES→500;
#   5. 同版本覆盖产物时 manifest 内存缓存旧 hash 的坑（M1 后按 mtime 失效,
#      新文件名天然规避）;
#   6. 每步失败立即退出并打印回滚指引;旧目录与旧卷全程保留可回滚;
#   7. 启动/健康验证失败**自动回滚**（v2.5.47 实录：新包 compose 里 8080 双绑,
#      up -d 必失败,而那一刻旧容器已 down → 线上中断 2.5 分钟、恢复靠人工。
#      迁移是 cp 不是 mv,旧卷一直在,"把旧栈拉回来"永远可行,不该只打印一行指引）。
#
# 事后仍需人工:GitHub 上确认 CI 产物存在（脚本按 release 资产直链拉取）。
set -euo pipefail

TARGET="${1:?用法: bash upgrade.sh <新版本号>（如 GitHub Release 的 tag 版本号）}"
[[ "$TARGET" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "[FAIL] 版本号格式非法: $TARGET"; exit 1; }

REPO="Hermitweb/dustnote"
OPT_DIR="/opt"
NEW_DIR="${OPT_DIR}/dustnote-server-v${TARGET}"
DL_DIR="/opt/dustnote-downloads"
CONTAINER="dustnote"
log() { echo "[$(date +%H:%M:%S)] $*"; }
die() { echo "[FAIL] $*" >&2; exit 1; }

# 自动回滚：新栈起不来就把旧栈原地拉回（旧目录与旧数据卷在迁移后仍完整）。
#
# 动机（v2.5.47 升级实录）：`up -d` 因新包 docker-compose.yml 里 8080 被重复声明
# （回环 + 0.0.0.0 两条互斥绑定）失败；脚本按 set -e 直接退出，那一刻旧容器已 down、
# 新容器起不来 —— 线上中断 2.5 分钟，恢复靠人工。迁移是 cp 不是 mv，旧卷一直在，
# 所以"把旧栈拉回来"永远可行，应当自动做掉，而不是只打印一句回滚指引。
#
# 诚实边界：
#  - 回滚会把**旧包的端口绑定**一并带回来（旧包可能弱于新版，如 0.0.0.0 暴露）
#    —— 先让服务回来，收口问题按日志提示另行核对；
#  - 迁移之后新容器若已写入，那部分写入留在新卷里，回滚后不可见（升级失败本就该人工看一眼）。
rollback() {
  log "[回滚] $*"
  docker compose -f "${NEW_DIR}/docker-compose.yml" -p "$NEW_PROJECT" down >/dev/null 2>&1 || true
  if docker compose -f "${OLD_DIR}/docker-compose.yml" -p "$OLD_PROJECT" up -d; then
    log "[回滚] 旧版本已恢复（数据卷 ${OLD_PROJECT}_dustnote-data 未动）"
    log "[回滚] 注意：旧版 compose 的端口绑定已随旧包回归，请核对 R1 收口（8080 是否只绑回环）"
  else
    log "[回滚] 旧栈也没能起来 —— 需要人工介入（docker logs ${CONTAINER}）"
  fi
  die "升级中断，已尝试回滚；新目录 ${NEW_DIR} 保留供排查（先别删）"
}

# ── 0. 现状反查（label 优先,杜绝目录猜谜）──────────────────────────
docker inspect "$CONTAINER" >/dev/null 2>&1 || die "容器 $CONTAINER 未在运行,本脚本只处理升级场景"
OLD_DIR=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$CONTAINER")
OLD_PROJECT=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$CONTAINER")
OLD_VER=$(docker exec "$CONTAINER" node -e 'fetch("http://127.0.0.1:8080/api/v1/health").then(r=>r.json()).then(j=>console.log(j.version))' 2>/dev/null || echo unknown)
[[ "$OLD_DIR" == "$NEW_DIR" ]] && die "目标版本 ${TARGET} 已是当前运行版本"
[[ -d "$NEW_DIR" ]] && die "目录已存在: $NEW_DIR（先人工确认是否为半成品再决定删除）"
log "当前运行: dir=${OLD_DIR} project=${OLD_PROJECT} version=${OLD_VER}"

# ── 1. 下载并解包 ───────────────────────────────────────────────────
ZIP="${OPT_DIR}/dustnote-server-v${TARGET}.zip"
log "拉取 release zip ..."
curl -sL --fail -o "$ZIP" "https://github.com/${REPO}/releases/download/v${TARGET}/dustnote-server-v${TARGET}.zip" \
  || die "zip 下载失败（确认 tag v${TARGET} 的 CI 已完成）"
TMPX=$(mktemp -d)
unzip -q "$ZIP" -d "$TMPX"
# 兼容两种打包形态：嵌套一层目录 / 直接平铺
if [[ -f "$TMPX/docker-compose.yml" ]]; then SRC="$TMPX"; else
  SRC=$(dirname "$(find "$TMPX" -maxdepth 2 -name docker-compose.yml | head -1)")
fi
[[ -n "$SRC" && -f "$SRC/docker-compose.yml" ]] || die "zip 内未找到 docker-compose.yml"
# 路径锚定加固：SRC 必须 realpath 位于本次 mktemp 目录内，且 NEW_DIR 必须
# 绝对路径且不存在——防畸形 TARGET/符号链接把 find/mv 变成移动当前工作目录
SRC=$(realpath "$SRC")
TMPX=$(realpath "$TMPX")
NEW_DIR=$(realpath -m "$NEW_DIR")
case "$SRC" in
  "$TMPX"|"$TMPX"/*) ;;
  *) die "解包路径越界: $SRC" ;;
esac
[[ "$NEW_DIR" == /opt/dustnote-server-v* ]] || die "目标目录异常: $NEW_DIR"
[[ ! -e "$NEW_DIR" ]] || die "目录已存在: $NEW_DIR"
mv "$SRC" "$NEW_DIR"; rm -rf "$TMPX"
log "解包完成: $NEW_DIR"

# ── 2. .env 迁移 + 版本字段更新 ─────────────────────────────────────
[[ -f "${OLD_DIR}/.env" ]] || die "旧目录无 .env: ${OLD_DIR}"
cp "${OLD_DIR}/.env" "${NEW_DIR}/.env"
sed -i -E "s/^(SERVER_VERSION=).*/\1${TARGET}/; s/^(RECOMMENDED_CLIENT_VERSION=).*/\1${TARGET}/" "${NEW_DIR}/.env"
grep -E "^(SERVER_VERSION|RECOMMENDED_CLIENT_VERSION)=" "${NEW_DIR}/.env" || die ".env 版本字段写入失败"
log ".env 已迁移（SERVER_VERSION=${TARGET}）"

# ── 3. 先构建镜像（不动旧容器,零停机）──────────────────────────────
log "compose build（约 5-8 分钟）..."
NEW_PROJECT=$(basename "$NEW_DIR" | tr -d '.@')
docker compose -f "${NEW_DIR}/docker-compose.yml" -p "$NEW_PROJECT" build

# ── 4. 停机切换：down 旧（正确目录!）→ create 新 → 迁卷 → up ────────
# 所有 compose 调用一律显式 -f + -p：**2026-09-25 深夜实战首撞**——down 后 cwd 停在
# 旧目录,裸的 create 在旧项目上重建了旧容器（镜像已换新版,容器名/卷名/项目
# 名全是旧的,健康断言才暴露）。cwd 依赖就是事故源,全部锚定。
log "停止旧版本（优雅停,WAL checkpoint）..."
docker compose -f "${OLD_DIR}/docker-compose.yml" -p "$OLD_PROJECT" down
docker compose -f "${NEW_DIR}/docker-compose.yml" -p "$NEW_PROJECT" create
V_DATA="${NEW_PROJECT}_dustnote-data"
V_BAK="${NEW_PROJECT}_dustnote-backups"
docker volume inspect "$V_DATA" >/dev/null 2>&1 || die "新数据卷未创建: $V_DATA（compose -p 生效?）"
OLD_DATA="${OLD_PROJECT}_dustnote-data"
OLD_BAK="${OLD_PROJECT}_dustnote-backups"
log "迁移数据卷 ${OLD_DATA} → ${V_DATA} ..."
docker run --rm -v "${OLD_DATA}:/src:ro" -v "${V_DATA}:/dst" alpine \
  sh -c 'cp -a /src/. /dst/ && chown -R 1001:0 /dst' || die "data 卷迁移失败"
log "迁移备份卷 ${OLD_BAK} → ${V_BAK} ..."
docker run --rm -v "${OLD_BAK}:/src:ro" -v "${V_BAK}:/dst" alpine \
  sh -c 'cp -a /src/. /dst/ && chown -R 1001:0 /dst' || die "backups 卷迁移失败"
log "启动新版本 ..."
docker compose -f "${NEW_DIR}/docker-compose.yml" -p "$NEW_PROJECT" up -d \
  || rollback "新容器启动失败（先查新包 compose 有无重复/互斥的端口绑定，如 8080 双绑 → address already in use）"

# ── 5. 健康验证（版本必须真的是 TARGET）─────────────────────────────
log "等待 health ..."
for i in $(seq 1 30); do
  sleep 4
  V=$(docker exec "$CONTAINER" node -e 'fetch("http://127.0.0.1:8080/api/v1/health").then(r=>r.json()).then(j=>console.log(j.version)).catch(()=>console.log("ERR"))' 2>/dev/null || echo ERR)
  [[ "$V" == "$TARGET" ]] && break
done
[[ "$V" == "$TARGET" ]] || rollback "健康验证失败: 当前版本=${V}（docker logs $CONTAINER 看新栈日志）"
log "服务端 ${TARGET} 运行正常"

# ── 6. downloads 三件套同步（x64/arm64/apk,旧版本删除）──────────────
if [[ "${SKIP_DOWNLOADS:-0}" != "1" ]]; then
  log "同步 downloads 三件套 ..."
  for f in "DustNote_${TARGET}_x64-setup.exe" "DustNote_${TARGET}_arm64-setup.exe" "DustNote_${TARGET}_android.apk"; do
    curl -sL --fail -o "${DL_DIR}/${f}" "https://github.com/${REPO}/releases/download/v${TARGET}/${f}" \
      || die "产物下载失败: $f"
  done
  # 删除非本版本文件（历史教训：chmod 644 漏做 → manifest 读 hash EACCES → 500）
  find "$DL_DIR" -maxdepth 1 -type f ! -name "*${TARGET}*" -delete
  chmod 644 "${DL_DIR}"/* 2>/dev/null || true
  ls -la "$DL_DIR"
  log "downloads 完成"
fi

# ── 7. 监控栈跟随换代（2026-10-02 加）──────────────────────────────
# 事故形态：主栈换代只重建主容器，监控栈的 bind mount 会永远停在**首次部署**的目录。
# 已实锤一次：deploy/monitoring/bridge.mjs 的 P0-2 修复（零送达回 502 + /stats）进了仓库、
# 进了测试，线上跑的却还是修复前的旧版 —— 告警最后一跳静默失效 6 天，CI 与状态页全绿。
# 所以这里既重建、也断言挂载源真的换到了新目录；断言不成立直接 die，不留"大概升级过了"。
MON_NEW="${NEW_DIR}/deploy/monitoring"
if docker ps --format '{{.Names}}' | grep -q '^dustnote-monitoring-'; then
  [[ -d "$MON_NEW" ]] || die "监控栈在运行，但新版本包里没有 deploy/monitoring"
  MON_ENV="${MON_NEW}/.env.monitoring"
  if [[ ! -f "$MON_ENV" ]]; then
    # .env.monitoring 含 topic 与凭据，不进版本包：从上一版目录继承；两边都没有就要求人工建
    if [[ -f "${OLD_DIR}/deploy/monitoring/.env.monitoring" ]]; then
      cp "${OLD_DIR}/deploy/monitoring/.env.monitoring" "$MON_ENV"
      log "监控栈 .env.monitoring 已从 ${OLD_DIR} 继承"
    else
      die "找不到监控栈 .env.monitoring（新旧目录都没有）：cd ${MON_NEW} && cp .env.monitoring.example .env.monitoring，填好 NTFY_TOPIC 再升级"
    fi
  fi
  docker compose -f "${MON_NEW}/compose.monitoring.yml" --env-file "$MON_ENV" up -d >/dev/null
  MOUNT=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/bridge.mjs"}}{{.Source}}{{end}}{{end}}' \
    dustnote-monitoring-ntfy-bridge-1 2>/dev/null || true)
  WANT=$(realpath "${MON_NEW}/bridge.mjs")
  GOT=$(realpath "$MOUNT" 2>/dev/null || echo "$MOUNT")
  [[ -n "$GOT" && "$GOT" == "$WANT" ]] ||
    die "监控栈挂载源仍是 ${GOT:-未取到}（应为 ${WANT}）：compose 已重建但 bridge 没跟上，告警链路的修复等于没上线"
  log "监控栈已跟随换代，挂载源核验通过：${GOT}"
else
  log "监控栈未在运行，跳过同步（要启用见 deploy/monitoring/README.md）"
fi

# ── 8. 缓存回收（每次发版后纪律,v2.5.41 实收 6.4G）─────────────────
docker builder prune -f | tail -1
df -h / | tail -1

log "全部完成。回滚资料保留: ${OLD_DIR} 与 ${OLD_PROJECT}_* 卷（确认稳定后可人工清理）"
