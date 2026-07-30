#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
cd "$SCRIPT_DIR"

NODE_BIN=$(command -v node || true)
if [[ -z "$NODE_BIN" ]]; then
  echo "未找到 Node.js，请先安装 Node.js 22 或更高版本。"
  read -r "?按回车关闭"
  exit 1
fi

NODE_MAJOR=$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])')
if (( NODE_MAJOR < 22 )); then
  echo "Node.js 版本过低，当前为 v$("$NODE_BIN" -p 'process.versions.node')。"
  echo "请升级到 Node.js 22 或更高版本。"
  read -r "?按回车关闭"
  exit 1
fi

export DNS_GUARD_PORT=${DNS_GUARD_PORT:-41731}

if ! [[ "$DNS_GUARD_PORT" =~ '^[0-9]+$' ]] || (( DNS_GUARD_PORT < 1 || DNS_GUARD_PORT > 65535 )); then
  echo "端口号无效：$DNS_GUARD_PORT"
  read -r "?按回车关闭"
  exit 1
fi

if /usr/sbin/lsof -nP -iTCP:"$DNS_GUARD_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "端口 $DNS_GUARD_PORT 已被占用。"
  echo "请关闭之前的 DNS 守卫窗口，再重新双击启动。"
  read -r "?按回车关闭"
  exit 1
fi

echo "正在启动 DNS 守卫……"
echo "页面打开后请保持此窗口运行；按 Control-C 可停止。"
exec "$NODE_BIN" server.mjs
