# AISee CLI

Command-line interface for [AISee](https://app.aisee.live) — automate AEO (Answer Engine Optimization) analysis and multi-channel content distribution from your terminal.

## Features

- **Device Authorization Flow (RFC 8628)** — browser-based OAuth login, no terminal passwords.
- **AEO Analysis** — scan websites, fetch AI-presence reports, competitor analysis, strategic recommendations.
- **Action Pipeline** — convert optimization tasks into social media post drafts in one command.
- **Social Media Automation** — create, schedule, and publish posts across X, LinkedIn, Reddit, and more.
- **Structured Output** — every command supports `--format json|table|csv|yaml|jsonl` and `--fields` dot-path selection.
- **Built on apcore-cli 0.7.0** — audit logging, dry-run preflight, pipeline trace, approval gate.

## Requirements

- **Run (Node.js)**: [Node.js](https://nodejs.org) ≥ 18.0. Standard npm package is lightweight (~2MB).
- **Run (Standalone)**: No runtime dependency — ships as a self-contained native executable (~60MB).
- **Build**: [Bun](https://bun.sh) ≥ 1.0 is required to build from source.

## Installation

### npm (recommended for Node.js users)

```bash
npm install -g aisee
```
Installs a lightweight JS bundle that runs on your local Node.js.

### bun (recommended for Bun users)

```bash
bun install -g aisee
```

### Standalone Binary (no Node/Bun required)

Download the pre-compiled binary for your platform from the [Releases](https://github.com/aisee-live/aisee-cli/releases) page.

```bash
# macOS/Linux
curl -L https://github.com/aisee-live/aisee-cli/releases/latest/download/aisee -o /usr/local/bin/aisee
chmod +x /usr/local/bin/aisee
```

### Windows — from source

```powershell
git clone <repository-url>
cd aisee-cli
bun install

.\scripts\install.ps1                          # %LOCALAPPDATA%\Programs\aisee + PATH
.\scripts\install.ps1 -InstallDir "C:\tools"   # or a custom directory
```

## Quick Start

```bash
aisee login                              # browser OAuth → save credentials
aisee scan https://example.com           # start AEO analysis
aisee report https://example.com         # view latest report
aisee whoami                             # current user + credit balance
```

## Documentation

| Document | Contents |
|---|---|
| [Command Reference](./docs/COMMANDS.md) | All commands, flags, and examples |
| [Specification](./docs/SPECIFICATION.md) | Architecture, auth flow, build system, config schema |
| [Publishing Guide](./docs/PUBLISHING.md) | How to release to npm and manage platform packages |

## Building for Distribution

```bash
# Current platform (runs automatically on bun install)
bun run prepare

# Specific platform
bun run build:macos-arm64
bun run build:linux-x64
bun run build:windows-x64

# All five platforms at once
bun run build:all
```

Output binaries land in `dist/`:

| File | Platform |
|---|---|
| `dist/aisee-darwin-arm64` | macOS Apple Silicon |
| `dist/aisee-darwin-x64` | macOS Intel |
| `dist/aisee-linux-x64` | Linux x86-64 |
| `dist/aisee-linux-arm64` | Linux ARM64 |
| `dist/aisee-windows-x64.exe` | Windows x86-64 |

## Tech Stack

| Layer | Package |
|---|---|
| Runtime | Node.js ≥ 18 / Bun ≥ 1.0 / Standalone |
| Language | TypeScript (strict) |
| Core SDK | `apcore-js` ≥ 0.19.0 |
| CLI SDK | `apcore-cli` 0.7.0 |
| Toolkit | `apcore-toolkit` ≥ 0.5.0 |
| Schema | Zod v3 |

---

© 2026 AISee Engineering. All rights reserved.
