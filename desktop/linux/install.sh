#!/usr/bin/env bash
#
# DustNote Linux 桌面集成安装脚本
#
# 将 .desktop 文件与图标安装到系统菜单，使 DustNote 出现在应用列表中。
# 支持系统级（/usr/share，需 sudo）与用户级（~/.local/share，无需 sudo）两种安装方式。
#
# 用法：
#   ./install.sh                # 默认用户级安装（无需 sudo）
#   ./install.sh --system       # 系统级安装（需 sudo）
#   ./install.sh --bin /path/to/dustnote-desktop  # 指定可执行文件路径
#   ./install.sh --icon /path/to/icon.png         # 指定图标文件
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 默认参数
SCOPE="user"
BIN_PATH=""
ICON_PATH=""

# 解析参数
while [[ $# -gt 0 ]]; do
  case "$1" in
    --system)
      SCOPE="system"
      shift
      ;;
    --user)
      SCOPE="user"
      shift
      ;;
    --bin)
      BIN_PATH="$2"
      shift 2
      ;;
    --icon)
      ICON_PATH="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      exit 1
      ;;
  esac
done

# 确定安装目录
if [[ "$SCOPE" == "system" ]]; then
  APPS_DIR="/usr/share/applications"
  ICON_DIR="/usr/share/icons/hicolor/256x256/apps"
else
  APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/256x256/apps"
fi

# 定位可执行文件
if [[ -z "$BIN_PATH" ]]; then
  # 优先使用 PATH 中的 dustnote-desktop
  if command -v dustnote-desktop >/dev/null 2>&1; then
    BIN_PATH="$(command -v dustnote-desktop)"
  elif [[ -x "/opt/dustnote/dustnote-desktop" ]]; then
    BIN_PATH="/opt/dustnote/dustnote-desktop"
  elif [[ -x "$HOME/Applications/DustNote.AppImage" ]]; then
    BIN_PATH="$HOME/Applications/DustNote.AppImage"
  else
    echo "⚠ 未找到 dustnote-desktop 可执行文件。" >&2
    echo "  请通过 --bin 参数指定，或将 AppImage 移动到以下任一位置：" >&2
    echo "    /opt/dustnote/dustnote-desktop" >&2
    echo "    \$HOME/Applications/DustNote.AppImage" >&2
    echo "  或将其加入 PATH。" >&2
    exit 1
  fi
fi

# 定位图标
if [[ -z "$ICON_PATH" ]]; then
  if [[ -f "$SCRIPT_DIR/dustnote.png" ]]; then
    ICON_PATH="$SCRIPT_DIR/dustnote.png"
  elif [[ -f "$SCRIPT_DIR/icon.png" ]]; then
    ICON_PATH="$SCRIPT_DIR/icon.png"
  else
    echo "⚠ 未找到图标文件（dustnote.png / icon.png）。" >&2
    echo "  请通过 --icon 参数指定。" >&2
    exit 1
  fi
fi

echo "==> 安装范围: $SCOPE"
echo "==> 可执行文件: $BIN_PATH"
echo "==> 图标文件: $ICON_PATH"
echo "==> 应用目录: $APPS_DIR"
echo "==> 图标目录: $ICON_DIR"
echo

# 创建目录
sudo_prefix=""
if [[ "$SCOPE" == "system" ]]; then
  sudo_prefix="sudo"
fi
$sudo_prefix mkdir -p "$APPS_DIR" "$ICON_DIR"

# 生成 .desktop 文件（替换 Exec 路径）
DESKTOP_FILE="$APPS_DIR/dustnote.desktop"
TMP_DESKTOP="$(mktemp)"
sed "s|^Exec=.*|Exec=$BIN_PATH %U|" "$SCRIPT_DIR/dustnote.desktop" > "$TMP_DESKTOP"
$sudo_prefix install -m 644 "$TMP_DESKTOP" "$DESKTOP_FILE"
rm -f "$TMP_DESKTOP"

# 安装图标
$sudo_prefix install -m 644 "$ICON_PATH" "$ICON_DIR/dustnote.png"

# 更新桌面数据库与图标缓存
if command -v update-desktop-database >/dev/null 2>&1; then
  $sudo_prefix update-desktop-database "$APPS_DIR" 2>/dev/null || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  $sudo_prefix gtk-update-icon-cache /usr/share/icons/hicolor/ 2>/dev/null || true
fi

echo
echo "✓ DustNote 已集成到系统菜单。"
echo "  现在可以在应用列表中搜索 DustNote 并启动。"
echo
echo "卸载请运行: ./uninstall.sh $([[ "$SCOPE" == "system" ]] && echo "--system")"
