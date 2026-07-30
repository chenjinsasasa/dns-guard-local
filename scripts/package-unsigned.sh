#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
VERSION=$(cd "$PROJECT_DIR" && node -p 'require("./package.json").version')
ARCHIVE="$PROJECT_DIR/dist/DNS-Guard-$VERSION-unsigned.zip"
CHECKSUMS="$PROJECT_DIR/dist/SHA256SUMS"

"$SCRIPT_DIR/build-macos-app.sh"
if [[ -e "$ARCHIVE" ]]; then
  /bin/rm "$ARCHIVE"
fi
ditto -c -k --sequesterRsrc --keepParent "$PROJECT_DIR/dist/DNS守卫.app" "$ARCHIVE"

cd "$PROJECT_DIR/dist"
shasum -a 256 "$(basename "$ARCHIVE")" > "$CHECKSUMS"
echo "Packaged: $ARCHIVE"
echo "Checksums: $CHECKSUMS"
