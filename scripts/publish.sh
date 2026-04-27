#!/usr/bin/env sh
# AISee CLI — publish all platform packages then the main package.
#
# Usage:
#   sh scripts/publish.sh           # publish current version
#   sh scripts/publish.sh --dry-run # preview without actually publishing
#   sh scripts/publish.sh --tag next # publish under an npm dist-tag
#
# Prerequisites:
#   - npm login (or NPM_TOKEN env var set in CI)
#   - bun >= 1.0 installed
set -e

# ── Parse flags ──────────────────────────────────────────────────────────────
DRY_RUN=0
TAG="latest"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --tag)     TAG="$2"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

NPM_FLAGS="--access public --tag $TAG"
if [ "$DRY_RUN" = "1" ]; then
  NPM_FLAGS="$NPM_FLAGS --dry-run"
  echo "[dry-run] No packages will actually be published."
fi

# ── Read version from package.json ───────────────────────────────────────────
VERSION=$(node -e "process.stdout.write(require('./package.json').version)")
echo "Publishing aisee v$VERSION (tag: $TAG)"

# ── 1. Build all platform binaries ───────────────────────────────────────────
echo ""
echo "==> Building all platform binaries..."
bun run build:all

# ── 2. Platform packages metadata ────────────────────────────────────────────
# Each entry: "<npm-name>  <os>  <cpu>  <dist-binary>"
PLATFORMS="
aisee-darwin-arm64  darwin  arm64  aisee-darwin-arm64
aisee-darwin-x64    darwin  x64    aisee-darwin-x64
aisee-linux-x64     linux   x64    aisee-linux-x64
aisee-linux-arm64   linux   arm64  aisee-linux-arm64
aisee-win32-x64     win32   x64    aisee-windows-x64.exe
"

# ── 3. Publish each platform package ─────────────────────────────────────────
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo ""
echo "==> Publishing platform packages..."

echo "$PLATFORMS" | while IFS= read -r line; do
  # skip blank lines
  [ -z "$(echo "$line" | tr -d ' ')" ] && continue

  PKG_NAME=$(echo "$line"  | awk '{print $1}')
  PKG_OS=$(echo "$line"    | awk '{print $2}')
  PKG_CPU=$(echo "$line"   | awk '{print $3}')
  BINARY=$(echo "$line"    | awk '{print $4}')

  SRC="dist/$BINARY"
  if [ ! -f "$SRC" ]; then
    echo "  ERROR: $SRC not found — did build:all succeed?" >&2
    exit 1
  fi

  # Determine bin filename inside the package (always "aisee" on Unix, "aisee.exe" on Windows)
  case "$PKG_OS" in
    win32) BIN_FILE="aisee.exe" ;;
    *)     BIN_FILE="aisee" ;;
  esac

  PKG_DIR="$TMPDIR/$PKG_NAME"
  mkdir -p "$PKG_DIR/bin"

  cp "$SRC" "$PKG_DIR/bin/$BIN_FILE"
  if [ "$PKG_OS" != "win32" ]; then
    chmod +x "$PKG_DIR/bin/$BIN_FILE"
  fi

  # Write package.json
  cat > "$PKG_DIR/package.json" <<EOF
{
  "name": "$PKG_NAME",
  "version": "$VERSION",
  "description": "AISee CLI binary — $PKG_OS $PKG_CPU",
  "os": ["$PKG_OS"],
  "cpu": ["$PKG_CPU"],
  "bin": { "aisee": "./bin/$BIN_FILE" },
  "files": ["bin/"]
}
EOF

  echo "  Publishing $PKG_NAME@$VERSION..."
  # shellcheck disable=SC2086
  (cd "$PKG_DIR" && npm publish $NPM_FLAGS)
done

# ── 4. Publish main package ───────────────────────────────────────────────────
echo ""
echo "==> Publishing main package (aisee@$VERSION)..."
# shellcheck disable=SC2086
npm publish $NPM_FLAGS

# ── 5. Verify ─────────────────────────────────────────────────────────────────
if [ "$DRY_RUN" = "0" ]; then
  echo ""
  echo "==> Verifying install..."
  npm install -g "aisee@$VERSION" --prefer-online
  aisee --version
fi

echo ""
echo "Done. aisee@$VERSION published."
