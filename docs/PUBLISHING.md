# Publishing Guide

AISee CLI uses the **platform-optional-package** pattern (same as esbuild, Biome, Prisma).
The main `aisee` package ships a Node.js dispatcher (`bin/aisee.js`) that resolves the
correct pre-compiled binary at runtime. Each platform binary is an independent npm package
listed as an optional dependency.

---

## Package Structure

```
aisee                    ← main package (dispatcher only, ~10 KB)
  bin/aisee.js               ← Node.js wrapper that finds & execs the binary
  dist/                      ← local-build fallback (not published to npm)

aisee-darwin-arm64      ← macOS Apple Silicon
aisee-darwin-x64        ← macOS Intel
aisee-linux-x64         ← Linux x86-64
aisee-linux-arm64       ← Linux ARM64
aisee-win32-x64         ← Windows x86-64
```

npm automatically installs only the matching optional package for the user's platform.

---

## Step-by-step Release

### 1. Build all binaries

```bash
bun run build:all
# Produces:
#   dist/aisee-darwin-arm64
#   dist/aisee-darwin-x64
#   dist/aisee-linux-x64
#   dist/aisee-linux-arm64
#   dist/aisee-windows-x64.exe
```

### 2. Publish everything

`publish.sh` handles all of this automatically — it creates temporary platform package
directories, writes their `package.json`, and publishes them before publishing the main package.

```bash
sh scripts/publish.sh
```

### 4. Verify the install

```bash
npm install -g aisee
aisee --version
```

---

## Development Install (no npm publish needed)

```bash
git clone <repo>
cd aisee-cli
bun install          # triggers prepare → builds dist/aisee-<platform>
node bin/aisee.js --help   # or: ./aisee --help after prepare
```

The `bin/aisee.js` dispatcher falls back to `dist/` when no optional platform package
is installed, so the monorepo workflow is unaffected.

---

## Version Bump Checklist

1. Update `version` in `package.json` (main).
2. Update `version` in each `aisee-*` platform package (handled automatically by `publish.sh`).
3. Update `optionalDependencies` in the main `package.json` to match.
4. Run `bun run build:all`.
5. Publish platform packages first, then the main package.
