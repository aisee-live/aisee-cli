#!/usr/bin/env sh
# AISee CLI installer — macOS and Linux
# Usage: sh scripts/install.sh [--prefix /usr/local]
set -e

PREFIX="/usr/local"
if [ "$1" = "--prefix" ] && [ -n "$2" ]; then
  PREFIX="$2"
fi
DEST="$PREFIX/bin/aisee"

# ── Detect OS + arch ──────────────────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64)  TARGET="darwin-arm64" ;;
      x86_64) TARGET="darwin-x64"   ;;
      *)      echo "Unsupported macOS arch: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      aarch64|arm64) TARGET="linux-arm64" ;;
      x86_64)        TARGET="linux-x64"   ;;
      *)             echo "Unsupported Linux arch: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS. Use install.ps1 on Windows." >&2
    exit 1
    ;;
esac

BINARY="dist/aisee-$TARGET"

# ── Build if binary missing ───────────────────────────────────────────────────
if [ ! -f "$BINARY" ]; then
  echo "Binary not found at $BINARY — building..."
  if ! command -v bun >/dev/null 2>&1; then
    echo "Bun is required to build. Install from https://bun.sh" >&2
    exit 1
  fi
  bun install
  # Map dist target name to package.json script name
  case "$TARGET" in
    darwin-arm64) SCRIPT="build:macos-arm64" ;;
    darwin-x64)   SCRIPT="build:macos-x64"   ;;
    linux-arm64)  SCRIPT="build:linux-arm64"  ;;
    linux-x64)    SCRIPT="build:linux-x64"    ;;
  esac
  bun run "$SCRIPT"
fi

# ── Install ───────────────────────────────────────────────────────────────────
INSTALL_CMD="install -m 755 $BINARY $DEST"

if [ -w "$(dirname "$DEST")" ]; then
  $INSTALL_CMD
else
  echo "Installing to $DEST (requires sudo)..."
  sudo $INSTALL_CMD
fi

echo "Installed: $DEST"
"$DEST" --version
