#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
DESTINATION_DIR="$HOME/Applications"
DESTINATION_APP="$DESTINATION_DIR/DNS守卫.app"
SUPPORT_DIR="$HOME/Library/Application Support/DNS Guard"
LEGACY_DATA="$PROJECT_DIR/data"
BUILT_APP="$PROJECT_DIR/build/.staging/DNS守卫.app"

NODE_BIN=$(command -v node || true)
YQ_BIN=$(command -v yq || true)
if [[ -z "$NODE_BIN" ]] || (( $("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])') < 22 )); then
  echo "需要 Node.js 22 或更高版本。请先运行：brew install node"
  exit 1
fi
if [[ -z "$YQ_BIN" || ! -x "/Applications/Clash Verge.app/Contents/MacOS/verge-mihomo" ]]; then
  echo "Clash 完整防护依赖未就绪，将使用仅检测模式。"
fi

cd "$PROJECT_DIR"
npm test
"$SCRIPT_DIR/build-macos-app.sh"
"$SCRIPT_DIR/verify-macos-app.sh"

mkdir -p "$DESTINATION_DIR" "$SUPPORT_DIR"
chmod 700 "$SUPPORT_DIR"
if [[ -f "$LEGACY_DATA/state.json" && ! -f "$SUPPORT_DIR/state.json" ]]; then
  ditto "$LEGACY_DATA" "$SUPPORT_DIR"
  chmod 700 "$SUPPORT_DIR" "$SUPPORT_DIR/backups" 2>/dev/null || true
  find "$SUPPORT_DIR" -type f -exec chmod 600 {} \;
  echo "已迁移现有保护状态与配置备份。"
fi

osascript -e 'tell application id "io.github.chenjinsasasa.dns-guard-local" to quit' 2>/dev/null || true
for ATTEMPT in 1 2 3 4 5; do
  if ! pgrep -x DNSGuardLauncher >/dev/null 2>&1; then
    break
  fi
  /bin/sleep 1
done
pkill -x DNSGuardLauncher 2>/dev/null || true

for PROCESS_PID in $(/usr/sbin/lsof -tiTCP:41731 -sTCP:LISTEN 2>/dev/null || true); do
  PROCESS_CWD=$(/usr/sbin/lsof -a -p "$PROCESS_PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  if [[ "$PROCESS_CWD" == "$DESTINATION_APP/Contents/Resources/dns-guard" ]]; then
    kill "$PROCESS_PID" 2>/dev/null || true
  fi
done

if [[ -e "$DESTINATION_APP" ]]; then
  /bin/rm -R "$DESTINATION_APP"
fi
ditto "$BUILT_APP" "$DESTINATION_APP"
open "$DESTINATION_APP"
echo "Installed: $DESTINATION_APP"
