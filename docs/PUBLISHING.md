# Publishing Guide

AISee CLI follows a **hybrid distribution** strategy:
1.  **npm (Standard)**: The main `@aisee/aisee` package is a standalone JavaScript bundle (~2MB) that runs on any Node.js (≥18) environment.
2.  **Standalone Binaries**: Pre-compiled binaries (~60MB) are built for all major platforms for users who do not have a JS runtime installed.

---

## Package Structure

```
@aisee/aisee             ← main package (JS bundle, ~2 MB)
  bin/aisee.js               ← The CLI entry point (runs on Node/Bun)
```

Users installing via `npm install -g @aisee/aisee` get the lightweight JS bundle.

---

## Step-by-step Release

### 1. Build everything

```bash
bun run build:all
# Produces:
#   bin/aisee.js (Node-compatible bundle)
#   dist/aisee-darwin-arm64
#   dist/aisee-darwin-x64
#   dist/aisee-linux-x64
#   dist/aisee-linux-arm64
#   dist/aisee-windows-x64.exe
```

### 2. Publish to npm

The `publish.sh` script builds the JS bundle and platform binaries, then publishes the main package `@aisee/aisee`.

```bash
sh scripts/publish.sh
```

### 3. Verify the install

```bash
npm install -g @aisee/aisee
aisee --version
```

---

## Development Workflow

```bash
git clone <repo>
cd aisee-cli
bun install          # installs deps
bun run build        # builds bin/aisee.js
node bin/aisee.js --help
```

---

## Version Bump Checklist

1. Update `version` in `package.json`.
2. Run `bun run build:all`.
3. Execute `sh scripts/publish.sh`.
