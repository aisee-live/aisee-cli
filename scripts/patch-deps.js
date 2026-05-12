#!/usr/bin/env node
// Patch third-party dist files that do an unguarded `require('../package.json')`.
// When bundled into a `bun build --compile` binary, that path resolves to
// `/$bunfs/package.json` at runtime and throws "Cannot find module". We wrap
// the call in try/catch with a fallback so the bundled binary keeps working.
//
// Idempotent: detects an already-patched file and exits early.
import { readFileSync, writeFileSync, existsSync, readlinkSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

const FIND =
  "import { createRequire } from 'node:module';\n" +
  "const _require = createRequire(import.meta.url);\n" +
  "const _pkg = _require('../package.json');\n" +
  "export const VERSION = _pkg.version;";

const REPLACE =
  "import { createRequire } from 'node:module';\n" +
  "let _pkgVersion = '0.0.0';\n" +
  "try {\n" +
  "    const _require = createRequire(import.meta.url);\n" +
  "    const _pkg = _require('../package.json');\n" +
  "    _pkgVersion = _pkg.version;\n" +
  "} catch {}\n" +
  "export const VERSION = _pkgVersion;";

const MARKER = "let _pkgVersion = '0.0.0';";

// Follow a pnpm symlink exactly ONE level (symlink → .pnpm/pkg@ver/node_modules/pkg)
// without recursively resolving further symlinks. This is needed because pnpm's virtual
// store uses real directories for published packages, while the workspace-level
// node_modules/pkg symlink points into the store — and realpathSync would overshoot
// into the local workspace source directory.
function resolveOnePnpmLink(linkPath) {
  if (!existsSync(linkPath)) return null;
  try {
    const target = readlinkSync(linkPath); // e.g. ".pnpm/pkg@x.y.z_.../node_modules/pkg"
    // link targets in pnpm are relative to the node_modules directory containing the link
    const nodeModulesDir = resolve(linkPath, "..");
    return resolve(nodeModulesDir, target);
  } catch {
    // Not a symlink — return as-is (real directory)
    return linkPath;
  }
}

// Collect all apcore-toolkit dist/index.js paths that Bun will bundle.
// 1. The directly installed copy (may be a workspace symlink → apcore-toolkit-typescript).
// 2. Copies inside workspace-symlinked peers (e.g. apcore-cli → apcore-cli-typescript),
//    resolved through the pnpm virtual store one level deep so we get the real files.
function collectPaths() {
  const paths = new Set();

  function addDistIndex(pkgDir) {
    const p = resolve(pkgDir, "dist/index.js");
    if (existsSync(p)) paths.add(p);
  }

  // 1. Direct install (may be a workspace symlink; realpath resolves it)
  const directPkg = resolve(repoRoot, "node_modules/apcore-toolkit");
  if (existsSync(directPkg)) {
    addDistIndex(realpathSync(directPkg));
  }

  // 2. Transitive through local-workspace peers
  const peers = ["apcore-cli", "apcore-js"];
  for (const peer of peers) {
    const peerLink = resolve(repoRoot, "node_modules", peer);
    if (!existsSync(peerLink)) continue;

    // Follow the peer's symlink to reach the actual workspace directory
    const peerReal = realpathSync(peerLink);
    const toolkitLink = resolve(peerReal, "node_modules/apcore-toolkit");
    if (!existsSync(toolkitLink)) continue;

    // Follow ONE pnpm level to get the virtual-store directory
    const toolkitStoreDir = resolveOnePnpmLink(toolkitLink);
    if (toolkitStoreDir) addDistIndex(toolkitStoreDir);
  }

  return [...paths];
}

for (const absPath of collectPaths()) {
  const label = absPath.replace(repoRoot + "/", "");
  const content = readFileSync(absPath, "utf-8");

  if (content.includes(MARKER)) {
    console.log(`patch-deps: ${label} already patched`);
    continue;
  }
  if (!content.includes(FIND)) {
    console.warn(`patch-deps: ${label} did not match expected pattern, skipping`);
    continue;
  }
  writeFileSync(absPath, content.replace(FIND, REPLACE));
  console.log(`patch-deps: patched ${label}`);
}
