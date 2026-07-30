#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
INSTALLED_APP="$HOME/Applications/DNS守卫.app"

if [[ -d "$INSTALLED_APP" ]]; then
  open "$INSTALLED_APP"
  exit 0
fi

echo "正在安装 DNS 守卫……"
exec "$SCRIPT_DIR/scripts/install-local.sh"
