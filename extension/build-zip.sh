#!/usr/bin/env bash
# Package the extension directory into a versioned zip for GitHub releases.
# Usage: ./extension/build-zip.sh
# Output: extension/dist/bompton-extension-vX.Y.Z.zip
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v zip >/dev/null 2>&1; then
  echo "error: 'zip' is not installed. Install it with your package manager." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "error: 'node' is not installed; needed to read extension/manifest.json." >&2
  exit 1
fi

VERSION=$(node -e "console.log(require('./manifest.json').version)")
OUT_DIR="dist"
OUT_FILE="$OUT_DIR/bompton-extension-v$VERSION.zip"

mkdir -p "$OUT_DIR"
rm -f "$OUT_FILE"

# Include the files the runtime needs; exclude tooling and the dist/ itself.
zip -r "$OUT_FILE" \
  manifest.json \
  background.js \
  popup.html \
  popup.css \
  popup.js \
  icons \
  -x '*.DS_Store' '*/.*'

echo "built $OUT_FILE"
ls -lh "$OUT_FILE"
