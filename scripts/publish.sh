#!/usr/bin/env sh
# AISee CLI — publish the main package to npm and binaries to GitHub.
#
# Usage:
#   sh scripts/publish.sh           # publish current version
#   sh scripts/publish.sh --dry-run # preview without actually publishing
#   sh scripts/publish.sh --tag next # publish under an npm dist-tag
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
echo "  Publishing @aisee/aisee v$VERSION (tag: $TAG)"

# ── 2. Build Everything ───────────────────────────────────────────────────────
echo ""
echo "==> Building JS bundle and all platform binaries..."
bun run build:all

# Verify JS bundle
if [ ! -f "bin/aisee.js" ]; then
  echo "  ERROR: bin/aisee.js not found — did build:all succeed?" >&2
  exit 1
fi

# ── 3. Pre-publish validation ─────────────────────────────────────────────────
echo ""
echo "==> Pre-publish validation..."
if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] Would run: npm install -g . && aisee --version"
else
  echo "  Installing local version globally for testing..."
  npm install -g .
  
  INSTALLED_VER=$(aisee --version)
  if [ "$INSTALLED_VER" != "$VERSION" ]; then
    echo "  ERROR: Version mismatch! Expected $VERSION, got $INSTALLED_VER"
    exit 1
  fi
  echo "  ✔ Pre-publish validation passed (aisee $INSTALLED_VER)."
fi

# ── 4. Publish main package ───────────────────────────────────────────────────
echo ""
echo "==> Publishing main package (aisee@$VERSION)..."
# shellcheck disable=SC2086
npm publish $NPM_FLAGS

# ── 5. Verify ─────────────────────────────────────────────────────────────────
if [ "$DRY_RUN" = "0" ]; then
  echo ""
  echo "==> Verifying final published package..."
  npm install -g "@aisee/aisee@$VERSION" --prefer-online
  aisee --version
fi

# ── 6. GitHub Release ─────────────────────────────────────────────────────────
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
echo "Done. @aisee/aisee@$VERSION published."
