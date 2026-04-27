# AISee CLI — Command Reference

## Global Options

Available on every command. Built-in apcore options are hidden by default; pass `--verbose` to reveal them.

| Flag | Default | Description |
|---|---|---|
| `--format <type>` | `table` (TTY) / `json` (pipe) | Output format: `table`, `json`, `csv`, `yaml`, `jsonl` |
| `--fields <paths>` | — | Comma-separated dot-paths to select from the result, e.g. `status,result.total_score` |
| `--dry-run` | false | Run preflight checks without executing — shows what would happen |
| `--trace` | false | Print per-step pipeline timing after the result |
| `--log-level <level>` | `WARNING` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `--verbose` | false | Show all built-in options in help output |
| `-V, --version` | — | Print CLI version |
| `-h, --help` | — | Print help |

---

## Authentication

### `aisee login`
Initiate the OAuth 2.0 Device Authorization Flow (RFC 8628).

Opens the browser automatically. Polls for authorization and stores tokens on success.

```bash
aisee login
```

### `aisee logout`
Clear local credentials (`~/.config/aisee/credentials.json`).

```bash
aisee logout
```

### `aisee whoami`
Display the currently authenticated user and credit balance.

```bash
aisee whoami
aisee whoami --format json
```

---

## Analysis

### `aisee scan <url>`
Start a full AEO analysis scan for a website.

```bash
aisee scan https://example.com
aisee scan https://example.com --use-demo          # no credits consumed
aisee scan https://example.com --format json
```

| Flag | Default | Description |
|---|---|---|
| `<url>` | required | Website URL to scan |
| `--task-template-id <id>` | — | Custom task template |
| `--streaming` | false | Enable streaming HTTP response from analysis API |
| `--use-demo` | false | Demo mode — no credits consumed |

### `aisee report <url>`
Retrieve the aggregated analysis report for a URL.

```bash
aisee report https://example.com
aisee report https://example.com --section ai-presence
aisee report https://example.com --history          # list all historical versions
aisee report https://example.com --version v3.0     # fetch a specific version
aisee report https://example.com --format json --fields result.total_score
```

| Flag | Default | Description |
|---|---|---|
| `<url>` | required | Website URL |
| `--section <name>` | `summary` | `summary`, `ai-presence`, `competitor`, `strategy`, `seo`, `mentions` |
| `--version <v>` | — | Fetch a specific historical version |
| `--history` | false | List all available historical versions |

---

## Actions

### `aisee actions list <url>`
List actionable optimization tasks for a site.

```bash
aisee actions list https://example.com
aisee actions list https://example.com --status pending --size 20
aisee actions list https://example.com --format json
```

| Flag | Default | Description |
|---|---|---|
| `<url>` | required | Website URL |
| `--page <n>` | 1 | Page number |
| `--size <n>` | 10 | Items per page (max 1000) |
| `--sort-by <field>` | `position` | Sort field |
| `--sort-order <asc\|desc>` | `asc` | Sort direction |
| `--status <s>` | — | Filter by status: `pending`, `in_progress`, `completed` |

### `aisee actions suggest <actionId>`
Get detailed AI-generated implementation suggestions for an action.

```bash
aisee actions suggest abc-123
```

### `aisee actions post <actionId>`
Convert an action's implementation plan into a social media post draft.

```bash
aisee actions post abc-123
aisee actions post abc-123 --channel linkedin-page-id
```

| Flag | Default | Description |
|---|---|---|
| `<actionId>` | required | Action ID |
| `--channel <id>` | — | Target channel ID |

---

## Post

### `aisee post create`
Create a new social media post.

```bash
aisee post create --channel x --text "Hello world"
aisee post create --channel linkedin --file ./draft.md --schedule 2026-05-01T10:00:00Z
aisee post create --channel instagram --text "Caption" --image ./photo.jpg
```

| Flag | Default | Description |
|---|---|---|
| `--channel <id>` | required | Channel ID or platform name |
| `--text <content>` | — | Direct post text |
| `--file <path>` | — | Path to a Markdown file (alternative to `--text`) |
| `--schedule <iso>` | — | Scheduled publication time (ISO 8601) |
| `--image <path>` | — | Local image file to attach |

### `aisee post list`
List recent posts with optional status filter.

```bash
aisee post list
aisee post list --state DRAFT --limit 20
aisee post list --format json
```

| Flag | Default | Description |
|---|---|---|
| `--state <s>` | — | `DRAFT`, `QUEUE`, `PUBLISHED`, `ERROR` |
| `--limit <n>` | 10 | Number of posts to return (max 100) |

### `aisee post dashboard`
View social media engagement and traffic metrics.

```bash
aisee post dashboard
aisee post dashboard --period 30d --channel x
```

| Flag | Default | Description |
|---|---|---|
| `--period <p>` | `7d` | `24h`, `7d`, `30d`, `90d` |
| `--channel <name>` | — | Filter by platform name |

### `aisee post publish <id>`
Publish a prepared post immediately.

```bash
aisee post publish abc-123
```

### `aisee post schedule <id> <time>`
Update the scheduled publication time for a post.

```bash
aisee post schedule abc-123 2026-05-01T10:00:00Z
```

---

## Channels

### `aisee channels list`
List all connected social media accounts and their connection status.

```bash
aisee channels list
aisee channels list --format json
```

### `aisee channels add <platform>`
Connect a new social media account via browser OAuth.

```bash
aisee channels add x
aisee channels add linkedin-page
```

Supported platforms: `x`, `reddit`, `linkedin`, `linkedin-page`, `instagram`, `facebook`, `youtube`, `tiktok`, `pinterest`, `threads`, `mastodon`, `bluesky`, `medium`, `devto`, `hashnode`

### `aisee channels remove <id>`
Disconnect and remove a social media integration.

```bash
aisee channels remove abc-123
```

---

## Config

### `aisee config list`
Show current configuration values and their sources.

```bash
aisee config list
aisee config list --format json
```

### `aisee config set`
Update a configuration value in `~/.config/aisee/config.yaml`.

```bash
aisee config set --key analysis_api_url --value https://api.aisee.live
aisee config set --key auth_api_url     --value https://api-auth.aisee.live
```

| Key | Description |
|---|---|
| `auth_api_url` | Auth service endpoint |
| `analysis_api_url` | Analysis / orchestrator endpoint |
| `post_agent_api_url` | Post agent endpoint |
| `app_url` | Web app URL |

### `aisee config spec <service>`
Print the embedded OpenAPI specification for an internal service.

```bash
aisee config spec auth
aisee config spec analysis
aisee config spec post-agent
aisee config spec analysis --format json
```

---

## Output Formats

All commands that return data support `--format`:

| Format | Use case |
|---|---|
| `table` | Human-readable (default in TTY) |
| `json` | Machine-readable, piping (default when stdout is not a TTY) |
| `csv` | Spreadsheet export |
| `yaml` | Config/document output |
| `jsonl` | Streaming / log ingestion |

Use `--fields` to select specific fields:

```bash
aisee report https://example.com --format json --fields result.total_score,status
```
