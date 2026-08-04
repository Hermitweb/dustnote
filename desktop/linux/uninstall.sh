#!/usr/bin/env bash
#
# DustNote Linux 桌面集成卸载脚本
#
# 移除 .desktop 文件与图标，并将 DustNote 从系统菜单中移除。
# 不会删除用户数据（~/.config/dustnote、~/.local/share/dustnote），
# 如需清除用户数据请手动删除或加 --purge 参数。
#
# 用法：
#   ./uninstall.sh                # 默认移除用户级集成
#   ./uninstall.sh --system       # 移除系统级集成（需 sudo）
#   ./uninstall.sh --all          # 同时移除用户级与系统级
#   ./uninstall.sh --purge        # 同时清除用户数据
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SCOPE="user"
PURGE="no"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --system) SCOPE="system"; shift ;;
    --user)   SCOPE="user"; shift ;;
    --all)    SCOPE="all"; shift ;;
    --purge)  PURGE="yes"; shift ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

remove_integration() {
  local apps_dir="$1"
  local icon_dir="$2"
  local sudo_prefix="$3"

  echo "==> 移除 $apps_dir 中的集成"
  $sudo_prefix rm -f "$apps_dir/dustnote.desktop" 2>/dev/null || true
  # 清理各尺寸图标
  for size in 16x16 22x22 24x24 32x32 48x48 64x64 128x128 256x256 512x512 scalable; do
    $sudo_prefix rm -f "/usr/share/icons/hicolor/${size}/apps/dustnote.png" 2>/dev/null || true
    $sudo_prefix rm -f "/usr/share/icons/hicolor/${size}/apps/dustnote.svg" 2>/dev/null || true
  done
  $sudo_prefix rm -f "$HOME/.local/share/icons/hicolor/256x256/apps/dustnote.png" 2>/dev/null || true

  if command -v update-desktop-database >/dev/null 2>&1; then
    $sudo_prefix update-desktop-database "$apps_dir" 2>/dev/null || true
  fi
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    $sudo_prefix gtk-update-icon-cache /usr/share/icons/hicolor/ 2>/dev/null || true
  fi
}

case "$SCOPE" in
  user)
    remove_integration \
      "${XDG_DATA_HOME:-$HOME/.local/share}/applications" \
      "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/256x256/apps" \
      ""
    ;;
  system)
    remove_integration "/usr/share/applications" "/usr/share/icons/hicolor/256x256/apps" "sudo"
    ;;
  all)
    remove_integration \
      "${XDG_DATA_HOME:-$HOME/.local/share}/applications" \
      "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/256x256/apps" \
      ""
    remove_integration "/usr/share/applications" "/usr/share/icons/hicolor/256x256/apps" "sudo"
    ;;
esac

# 清除用户数据（可选）
if [[ "$PURGE" == "yes" ]]; then
  echo "==> 清除用户数据"
  rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/dustnote" 2>/dev/null || true
  rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/dustnote" 2>/dev/null || true
  rm -rf "$HOME/.cache/dustnote" 2>/dev/null || true
  echo "✓ 用户数据已清除"
fi

echo
echo "✓ DustNote 桌面集成已移除。"
if [[ "$PURGE" != "yes" ]]; then
  echo "  用户数据保留在 ~/.config/dustnote 与 ~/.local/share/dustnote。"
  echo "  如需彻底清除，运行: ./uninstall.sh --purge"
fi
