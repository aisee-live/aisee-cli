# AISee CLI — Technical Specification

**Version:** 1.0.0  
**Status:** Current  
**Owner:** AISee Engineering

---

## 1. Overview

AISee CLI is a compiled, single-binary CLI that bridges two backend services:

- **AISee Orchestrator** (`api.aisee.live`) — AEO analysis, scoring, and action recommendations.
- **Post Agent** (`api-post.aisee.live`) — Social media post creation, scheduling, and channel management.

The CLI is thin by design: business logic lives in the backends. The CLI handles authentication, input collection, and output formatting.

---

## 2. Design Principles

- **Thin client** — delegate complex logic to the orchestrator; keep the CLI fast and predictable.
- **Standard UX** — primary operands are positional args; secondary controls are `--flags`. Follows GNU/POSIX conventions.
- **Structured output everywhere** — every command supports `--format json|table|csv|yaml|jsonl` and `--fields` selection.
- **Secure by default** — OAuth 2.0 Device Flow only; credentials stored in a local file, never in env vars or shell history.
- **Observable** — `--dry-run`, `--trace`, `--log-level DEBUG` available on every command via apcore-cli.

---

## 3. Architecture

### 3.1 Stack

| Layer | Technology |
|---|---|
| Runtime (build) | Bun ≥ 1.0 |
| Runtime (run) | Standalone binary — no Bun/Node required after install |
| Language | TypeScript (strict mode) |
| Core SDK | `apcore-js` ≥ 0.19.0 |
| CLI SDK | `apcore-cli` 0.7.0 |
| Toolkit | `apcore-toolkit` ≥ 0.5.0 (optional peer) |
| Schema | Zod v3 (input validation) |
| HTTP | Axios (with token refresh interceptor) |

### 3.2 Module System

Every command is an apcore module registered in a `Registry`. On startup:

```
Registry.register("scan", scanModule)
Registry.register("auth.login", loginModule)
...
```

The `APCore` unified client wraps the registry and executor. Three adapter classes bridge
the apcore-js and apcore-cli interface contracts:

| Adapter | Bridges |
|---|---|
| `ExecutorAdapter` | `apcore-js Executor.call()` → `apcore-cli Executor.execute()` |
| `RegistryAdapter` | `apcore-js Registry.list/getDefinition` → `apcore-cli Registry.listModules/getModule` |
| `zodToJsonSchema` | Zod v3 input schemas → JSON Schema (required by `buildModuleCommand`) |

### 3.3 CLI Bootstrap

```
createCli({ registry, executor, progName: "aisee", apcli: false })
  ↓ sets up: audit logger, approval handler, canonical help, apcli group (hidden)
  ↓ returns Commander program

buildModuleCommand(descriptor, executor)
  ↓ generates: --flags from JSON Schema, --dry-run, --trace, --stream, --format, --fields

withPositionals(cmd, ["url", "url"])
  ↓ preAction hook: maps excess positional argv → named option values
  ↓ both `cmd <val>` and `cmd --opt <val>` work
```

### 3.4 Service Clients

| Client | Base URL config key | Purpose |
|---|---|---|
| `analysisAxios` | `aisee.analysis_api_url` | Orchestrator — scans, reports, actions |
| `postAgentAxios` | `aisee.post_agent_api_url` | Post agent — posts, channels, dashboard |

Both instances share a response interceptor that handles automatic token refresh on HTTP 401.

---

## 4. Authentication Flow (RFC 8628)

### 4.1 Login sequence

```
aisee login
  │
  ├─ POST /auth/device/code  → { device_code, user_code, verification_uri, expires_in, interval }
  │
  ├─ print verification_uri + user_code to terminal
  ├─ open(verification_uri_complete)  ← opens browser automatically
  │
  ├─ poll POST /auth/token every <interval> seconds (ora spinner)
  │    ├─ "authorization_pending" → continue polling
  │    └─ success → { access_token, refresh_token, user }
  │
  └─ write ~/.config/aisee/credentials.json
```

### 4.2 Token refresh

The `analysisAxios` and `postAgentAxios` response interceptors catch HTTP 401 and:

1. Use `refresh_token` to POST `/auth/token/refresh`.
2. Update `credentials.json` with the new `access_token`.
3. Retry the original request.

If refresh fails, credentials are cleared and the user is prompted to run `aisee login`.

### 4.3 Credential storage

```
~/.config/aisee/
  credentials.json   ← { userId, email, accessToken, refreshToken, plan, credits }
  config.yaml        ← service URLs and executor settings
```

---

## 5. Build System

### 5.1 Scripts

| Script | Output | Trigger |
|---|---|---|
| `prepare` | `./aisee` (current platform) | Automatic on `bun install` |
| `build:macos-arm64` | `dist/aisee-darwin-arm64` | Manual |
| `build:macos-x64` | `dist/aisee-darwin-x64` | Manual |
| `build:linux-x64` | `dist/aisee-linux-x64` | Manual |
| `build:linux-arm64` | `dist/aisee-linux-arm64` | Manual |
| `build:windows-x64` | `dist/aisee-windows-x64.exe` | Manual |
| `build:all` | All five platforms | Manual / CI release |

`prepare` builds only the local platform binary to keep `bun install` fast. Use `build:all` before cutting a release.

### 5.2 npm distribution

The package uses the **platform-optional-package** pattern:

```
aisee (dispatcher)
  optionalDependencies:
    aisee-darwin-arm64   os:darwin  cpu:arm64
    aisee-darwin-x64     os:darwin  cpu:x64
    aisee-linux-x64      os:linux   cpu:x64
    aisee-linux-arm64    os:linux   cpu:arm64
    aisee-win32-x64      os:win32   cpu:x64
```

`bin/aisee.js` resolves the binary at runtime:
1. Optional platform package (`aisee-<os>-<arch>`)
2. Local `dist/` fallback (dev / monorepo)

See [PUBLISHING.md](./PUBLISHING.md) for the full release checklist.

### 5.3 Installation scripts (from source)

| Script | Platform | Default destination |
|---|---|---|
| `scripts/install.sh` | macOS, Linux | `/usr/local/bin/aisee` |
| `scripts/install.ps1` | Windows | `%LOCALAPPDATA%\Programs\aisee\aisee.exe` + user PATH |

Both scripts auto-build the platform binary from source if `dist/` does not already contain it.

---

## 6. Configuration

### 6.1 Priority hierarchy

1. CLI flags (`--log-level`, etc.) — highest
2. Environment variables (`AISEE_*`, `APCORE_*`)
3. Config file (`~/.config/aisee/config.yaml`)
4. Internal defaults — lowest

### 6.2 Config file schema

```yaml
# ~/.config/aisee/config.yaml

apcore:
  version: 1.0

executor:
  default_timeout: 300000   # 5 min — accommodates long-running scans
  global_timeout: 600000    # 10 min

aisee:
  auth_api_url:       https://api-auth.aisee.live
  analysis_api_url:   https://api.aisee.live
  post_agent_api_url: https://api-post.aisee.live
  app_url:            https://app.aisee.live
```

### 6.3 Environment variable overrides

| Env var | Maps to |
|---|---|
| `AISEE_AUTH_API_URL` | `aisee.auth_api_url` |
| `AISEE_ANALYSIS_API_URL` | `aisee.analysis_api_url` |
| `AISEE_POST_AGENT_API_URL` | `aisee.post_agent_api_url` |
| `APCORE_CLI_LOGGING_LEVEL` | `--log-level` |
| `APCORE_CLI_AUTO_APPROVE` | skip approval prompts |

---

## 7. Command Summary

### Top-level

| Command | Description |
|---|---|
| `login` | OAuth 2.0 Device Flow login |
| `logout` | Clear local credentials |
| `whoami` | Show current user + credit balance |
| `scan <url>` | Start full AEO analysis |
| `report <url>` | Fetch analysis report |

### `actions`

| Command | Description |
|---|---|
| `actions list <url>` | List optimization tasks |
| `actions suggest <actionId>` | AI implementation suggestions |
| `actions post <actionId>` | Convert task to post draft |

### `post`

| Command | Description |
|---|---|
| `post create` | Create a new social media post |
| `post list` | List posts with status filter |
| `post dashboard` | Engagement and traffic metrics |
| `post publish <id>` | Publish immediately |
| `post schedule <id> <time>` | Set scheduled publication time |

### `channels`

| Command | Description |
|---|---|
| `channels list` | List connected integrations |
| `channels add <platform>` | Connect via OAuth |
| `channels remove <id>` | Disconnect integration |

### `config`

| Command | Description |
|---|---|
| `config list` | Show effective configuration |
| `config set` | Update a config key |
| `config spec <service>` | Print embedded OpenAPI spec |

---

## 8. Error Handling

Errors are output via `emitErrorTty` (TTY) or `emitErrorJson` (pipe/CI), both from apcore-cli.

**TTY format:**
```
Error [MODULE_EXECUTE_ERROR]: Failed to execute module 'scan': <message>

  Details:
    moduleId: scan
    reason: <detail>

  Suggestion: <actionable hint>
  Exit code: 1
```

**JSON format (when stdout is not a TTY):**
```json
{ "error": true, "code": "MODULE_EXECUTE_ERROR", "message": "...", "exit_code": 1 }
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error |
| 2 | Invalid CLI input |
| 44 | Module dependency not found |
| 45 | Module not found |
| 46 | Schema validation error |
| 47 | ACL denied |
| 48 | Module execution error |
| 77 | Approval denied |
| 130 | SIGINT (Ctrl-C) |

---

## 9. Development

```bash
# Run from source (no build step)
bun run start

# Build local binary (also runs automatically on bun install)
bun run prepare

# Build all platform binaries
bun run build:all

# Install to /usr/local/bin (macOS/Linux)
sh scripts/install.sh

# Install on Windows
.\scripts\install.ps1

# Sync OpenAPI specs from running services
bun run sync-openapi
```
