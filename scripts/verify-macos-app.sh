#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
APP_BUNDLE="$PROJECT_DIR/build/.staging/DNS守卫.app"
BINARY="$APP_BUNDLE/Contents/MacOS/DNSGuardLauncher"
RESOURCES="$APP_BUNDLE/Contents/Resources/dns-guard"

if [[ ! -x "$BINARY" ]]; then
  echo "原生应用可执行文件缺失。"
  exit 1
fi

ARCHITECTURES=$(lipo -archs "$BINARY")
if [[ "$ARCHITECTURES" != *"arm64"* || "$ARCHITECTURES" != *"x86_64"* ]]; then
  echo "应用不是通用架构：$ARCHITECTURES"
  exit 1
fi

if [[ -d "$RESOURCES/public" ]] || find "$RESOURCES" -type f \( -name '*.html' -o -name '*.css' -o -name '*.js' \) | grep -q .; then
  echo "应用包中仍包含网页资源。"
  exit 1
fi

if strings "$BINARY" | grep -q 'WKWebView'; then
  echo "应用仍引用 WKWebView。"
  exit 1
fi

codesign --verify --deep --strict "$APP_BUNDLE"
echo "Verified native app: $APP_BUNDLE"
echo "Architectures: $ARCHITECTURES"
