#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
DESTINATION_DIR="$HOME/Applications"
DESTINATION_APP="$DESTINATION_DIR/DNS守卫.app"
SUPPORT_DIR="$HOME/Library/Application Support/DNS Guard"
LEGACY_DATA="$PROJECT_DIR/data"

NODE_BIN=$(command -v node || true)
YQ_BIN=$(command -v yq || true)
if [[ -z "$NODE_BIN" ]] || (( $("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])') < 22 )); then
  echo "需要 Node.js 22 或更高版本。请先运行：brew install node"
  exit 1
fi
if [[ -z "$YQ_BIN" ]]; then
  echo "需要 yq。请先运行：brew install yq"
  exit 1
fi
if [[ ! -x "/Applications/Clash Verge.app/Contents/MacOS/verge-mihomo" ]]; then
  echo "未找到 Clash Verge Rev，请先安装并启动 TUN。"
  exit 1
fi

cd "$PROJECT_DIR"
npm test
"$SCRIPT_DIR/build-macos-app.sh"

mkdir -p "$DESTINATION_DIR" "$SUPPORT_DIR"
chmod 700 "$SUPPORT_DIR"
if [[ -f "$LEGACY_DATA/state.json" && ! -f "$SUPPORT_DIR/state.json" ]]; then
  ditto "$LEGACY_DATA" "$SUPPORT_DIR"
  chmod 700 "$SUPPORT_DIR" "$SUPPORT_DIR/backups" 2>/dev/null || true
  find "$SUPPORT_DIR" -type f -exec chmod 600 {} \;
  echo "已迁移现有保护状态与配置备份。"
fi

pkill -x DNSGuardLauncher 2>/dev/null || true
if [[ -e "$DESTINATION_APP" ]]; then
  /bin/rm -R "$DESTINATION_APP"
fi
ditto "$PROJECT_DIR/dist/DNS守卫.app" "$DESTINATION_APP"
open "$DESTINATION_APP"
echo "Installed: $DESTINATION_APP"
