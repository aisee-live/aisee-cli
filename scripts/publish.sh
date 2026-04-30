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
#   - git repository with all changes committed
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

# ── 1. Pre-flight Checks ──────────────────────────────────────────────────────
echo "==> Running pre-flight checks..."

# Check git status
if [ -n "$(git status --porcelain)" ] && [ "$DRY_RUN" = "0" ]; then
  echo "  ERROR: Working directory is not clean. Commit all changes before publishing." >&2
  exit 1
fi

# Read version from package.json
VERSION=$(node -e "process.stdout.write(require('./package.json').version)")
echo "  Publishing aisee v$VERSION (tag: $TAG)"

# ── 2. Build and Verify Binaries ──────────────────────────────────────────────
echo ""
echo "==> Building all platform binaries..."
bun run build:all

# Each entry: "<npm-name>  <os>  <cpu>  <dist-binary>"
PLATFORMS="
aisee-darwin-arm64  darwin  arm64  aisee-darwin-arm64
aisee-darwin-x64    darwin  x64    aisee-darwin-x64
aisee-linux-x64     linux   x64    aisee-linux-x64
aisee-linux-arm64   linux   arm64  aisee-linux-arm64
aisee-win32-x64     win32   x64    aisee-windows-x64.exe
"

echo "==> Verifying binaries exist..."
# Avoid piped while loop to ensure variable visibility and error propagation
SAVE_IFS=$IFS
IFS='
'
for line in $PLATFORMS; do
  [ -z "$(echo "$line" | tr -d ' ')" ] && continue
  BINARY=$(echo "$line" | awk '{print $4}')
  SRC="dist/$BINARY"
  if [ ! -f "$SRC" ]; then
    echo "  ERROR: $SRC not found — did build:all succeed?" >&2
    exit 1
  fi
  echo "  ✔ $BINARY found."
done
IFS=$SAVE_IFS

# ── 3. Publish each platform package ─────────────────────────────────────────
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo ""
echo "==> Publishing platform packages..."

SAVE_IFS=$IFS
IFS='
'
for line in $PLATFORMS; do
  [ -z "$(echo "$line" | tr -d ' ')" ] && continue

  PKG_NAME=$(echo "$line"  | awk '{print $1}')
  PKG_OS=$(echo "$line"    | awk '{print $2}')
  PKG_CPU=$(echo "$line"   | awk '{print $3}')
  BINARY=$(echo "$line"    | awk '{print $4}')

  SRC="dist/$BINARY"

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
IFS=$SAVE_IFS

# ── 4. Pre-publish validation ─────────────────────────────────────────────────
echo ""
echo "==> Pre-publish validation..."
if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] Would run: npm install -g . && aisee --version"
else
  echo "  Installing local version globally for testing..."
  # Use --force to overwrite any existing installation
  npm install -g .
  
  INSTALLED_VER=$(aisee --version)
  if [ "$INSTALLED_VER" != "$VERSION" ]; then
    echo "  ERROR: Version mismatch! Expected $VERSION, got $INSTALLED_VER"
    exit 1
  fi
  echo "  ✔ Pre-publish validation passed (aisee $INSTALLED_VER)."
fi

# ── 5. Publish main package ───────────────────────────────────────────────────
echo ""
echo "==> Publishing main package (aisee@$VERSION)..."
# shellcheck disable=SC2086
npm publish $NPM_FLAGS

# ── 6. Verify ─────────────────────────────────────────────────────────────────
if [ "$DRY_RUN" = "0" ]; then
  echo ""
  echo "==> Verifying final published package..."
  # We use --prefer-online to ensure we hit the registry and not the local cache
  npm install -g "aisee@$VERSION" --prefer-online
  aisee --version
fi

# ── 7. GitHub Release ─────────────────────────────────────────────────────────
echo ""
echo "==> Preparing GitHub Release..."

if ! command -v gh >/dev/null 2>&1; then
  echo "  SKIP: GitHub CLI (gh) not found. Please upload binaries in dist/ manually to GitHub."
else
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] Would run: gh release create v$VERSION dist/* --title \"v$VERSION\" --generate-notes"
  else
    echo "  Creating tag v$VERSION..."
    git tag -a "v$VERSION" -m "Release v$VERSION" || { echo "  ERROR: Failed to create tag v$VERSION. Maybe it already exists?" >&2; exit 1; }
    
    echo "  Pushing tag to origin..."
    git push origin "v$VERSION" || { echo "  ERROR: Failed to push tag v$VERSION." >&2; exit 1; }

    echo "  Creating GitHub release and uploading binaries..."
    gh release create "v$VERSION" dist/* --title "v$VERSION" --generate-notes
    echo "  GitHub Release created successfully."
  fi
fi

echo ""
echo "Done. aisee@$VERSION published."
