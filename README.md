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

- Installed binary has **no runtime dependency** — ships as a self-contained native executable.
- [Bun](https://bun.sh) ≥ 1.0 is only required to **build from source**.

## Installation

### npm / bun (recommended)

```bash
npm install -g aisee
# or
bun install -g aisee
```

npm automatically downloads only the binary for your platform. No Bun required after install.

### macOS / Linux — from source

```bash
git clone <repository-url>
cd aisee-cli
bun install          # builds dist/aisee-<platform> via prepare script

sh scripts/install.sh              # install to /usr/local/bin
sh scripts/install.sh --prefix ~/.local   # or a custom prefix
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
| Runtime | Bun ≥ 1.0 (build) / standalone binary (run) |
| Language | TypeScript (strict) |
| Core SDK | `apcore-js` ≥ 0.19.0 |
| CLI SDK | `apcore-cli` 0.7.0 |
| Toolkit | `apcore-toolkit` ≥ 0.5.0 |
| Schema | Zod v3 |

---

© 2026 AISee Engineering. All rights reserved.
