#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
BUILD_DIR="$PROJECT_DIR/build/macos"
DIST_DIR="$PROJECT_DIR/dist"
APP_BUNDLE="$DIST_DIR/DNS守卫.app"
CONTENTS_DIR="$APP_BUNDLE/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
APP_RESOURCES="$RESOURCES_DIR/dns-guard"
SDK_PATH=$(xcrun --sdk macosx --show-sdk-path)

if [[ -e "$APP_BUNDLE" ]]; then
  /bin/rm -R "$APP_BUNDLE"
fi
mkdir -p "$BUILD_DIR" "$MACOS_DIR" "$APP_RESOURCES/public"

VERSION=$(node -p 'require("./package.json").version' 2>/dev/null || true)
if [[ -z "$VERSION" ]]; then
  echo "无法读取 package.json 版本，请确认已安装 Node.js。"
  exit 1
fi

ARM_BINARY="$BUILD_DIR/DNSGuardLauncher-arm64"
INTEL_BINARY="$BUILD_DIR/DNSGuardLauncher-x86_64"

swiftc -O -sdk "$SDK_PATH" -target arm64-apple-macosx13.0 \
  -framework AppKit "$PROJECT_DIR/macos/DNSGuardLauncher.swift" -o "$ARM_BINARY"
swiftc -O -sdk "$SDK_PATH" -target x86_64-apple-macosx13.0 \
  -framework AppKit "$PROJECT_DIR/macos/DNSGuardLauncher.swift" -o "$INTEL_BINARY"
lipo -create "$ARM_BINARY" "$INTEL_BINARY" -output "$MACOS_DIR/DNSGuardLauncher"

cp "$PROJECT_DIR/macos/Info.plist" "$CONTENTS_DIR/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$CONTENTS_DIR/Info.plist"
cp "$PROJECT_DIR/macos/AppIcon.icns" "$RESOURCES_DIR/AppIcon.icns"
cp "$PROJECT_DIR/server.mjs" "$PROJECT_DIR/core.mjs" "$PROJECT_DIR/package.json" "$APP_RESOURCES/"
cp "$PROJECT_DIR/public/index.html" "$PROJECT_DIR/public/styles.css" "$PROJECT_DIR/public/app.js" "$APP_RESOURCES/public/"
chmod 755 "$MACOS_DIR/DNSGuardLauncher"

plutil -lint "$CONTENTS_DIR/Info.plist" >/dev/null
codesign --force --deep --sign - "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE"

echo "Built: $APP_BUNDLE"
echo "Signature: ad-hoc (not notarized)"
