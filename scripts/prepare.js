#!/usr/bin/env node
// Called by the "prepare" npm lifecycle hook — builds the binary for the
// current platform and places it in dist/ where bin/aisee.js can find it.
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

const scriptMap = {
  "darwin-arm64": "build:macos-arm64",
  "darwin-x64":   "build:macos-x64",
  "linux-x64":    "build:linux-x64",
  "linux-arm64":  "build:linux-arm64",
  "win32-x64":    "build:windows-x64",
};

const key = `${process.platform}-${process.arch}`;
const script = scriptMap[key];

if (!script) {
  console.error(`prepare: unsupported platform ${key} — skipping binary build.`);
  process.exit(0);
}

try {
  execSync("bun --version", { stdio: "ignore" });
} catch {
  console.warn("prepare: bun not found. Skipping standalone binary build.");
  console.warn("i Standard JS bundle is still available for use with Node.js.");
  process.exit(0);
}

console.log(`prepare: building for ${key} (bun run ${script})`);
execSync(`bun run ${script}`, { stdio: "inherit" });
