#!/bin/zsh
set -euo pipefail

DESTINATION_APP="$HOME/Applications/DNS守卫.app"
SUPPORT_DIR="$HOME/Library/Application Support/DNS Guard"

pkill -x DNSGuardLauncher 2>/dev/null || true
if [[ -e "$DESTINATION_APP" ]]; then
  /bin/rm -R "$DESTINATION_APP"
  echo "已移除：$DESTINATION_APP"
fi

if [[ "${1:-}" == "--purge-data" && -e "$SUPPORT_DIR" ]]; then
  /bin/rm -R "$SUPPORT_DIR"
  echo "已清理运行数据：$SUPPORT_DIR"
else
  echo "运行数据已保留：$SUPPORT_DIR"
fi
