# AISee CLI — Command Reference

## Global Options

Available on every command. Built-in apcore options are hidden by default; pass `--all-options` to reveal them.

| Flag | Default | Description |
|---|---|---|
| `--format <type>` | `table` (TTY) / `json` (pipe) | Output format: `tui`, `table`, `markdown`, `json`, `csv`, `yaml`, `jsonl` |
| `--fields <paths>` | — | Comma-separated dot-paths to select from the result, e.g. `status,result.total_score` |
| `--dry-run` | false | Run preflight checks without executing — shows what would happen |
| `--trace` | false | Print per-step pipeline timing after the result |
| `--log-level <level>` | `WARNING` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `--verbose` | false | Show detailed output or return raw API response |
| `-V, --version` | — | Print CLI version |
| `-h, --help` | — | Print help |

---

## Authentication

### `aisee login`
Initiate the OAuth 2.0 Device Authorization Flow (RFC 8628).

Opens the browser automatically. Polls for authorization and stores tokens on success.

```bash
aisee login
aisee login --client-id my-custom-app
```

| Flag | Default | Description |
|---|---|---|
| `--client-id <id>` | `aisee-cli` | Optional client identifier |

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
Start AEO analysis for a product with complete task orchestration.

```bash
aisee scan https://example.com
aisee scan https://example.com --use-demo          # no credits consumed
aisee scan https://example.com --format json
```

| Flag | Default | Description |
|---|---|---|
| `<url>` | required | Website URL to scan |
| `--module <name>` | — | Specify a module to scan |
| `--streaming` | false | Enable streaming HTTP response from analysis API |
| `--use-demo` | false | Demo mode — no credits consumed |
| `--no-wait` | — | Return immediately after submitting (default: wait for results) |

### `aisee report <url>`
Retrieve the aggregated analysis report for a URL.

```bash
aisee report https://example.com
aisee report https://example.com --verbose          # show detailed per-model breakdown
aisee report https://example.com --section presence
aisee report https://example.com --history          # list all historical versions
aisee report https://example.com --ver 7.0          # fetch a specific version
aisee report https://example.com --format json --fields result.total_score
```

| Flag | Default | Description |
|---|---|---|
| `<url>` | required | Website URL |
| `--section <name>` | `summary` | `summary`, `presence`, `competitor`, `strategy` |
| `--ver <v>` | — | Fetch a specific historical version |
| `--history` | false | List all available historical versions |
| `--page <n>` | 1 | Page number for history listing |
| `--size <n>` | 10 | Items per page for history listing |
| `--verbose` | false | Show detailed output or return raw API response |

---

## Actions

### `aisee actions <url>`
List actionable optimization tasks for a site.

```bash
aisee actions https://example.com
aisee actions https://example.com --module presence --status pending
aisee actions https://example.com --format json
```

| Flag | Default | Description |
|---|---|---|
| `<url>` | required | Website URL |
| `--module <name>` | — | Filter by module: `presence`, `competitor`, `strategy` |
| `--page <n>` | 1 | Page number |
| `--size <n>` | 10 | Items per page (max 1000) |
| `--sort-by <field>` | `position` | Sort field |
| `--sort-order <asc\|desc>` | `asc` | Sort direction |
| `--status <s>` | — | Filter by status: `pending`, `in_progress`, `completed` |
| `--has-solution` | false | Filter by has solution |
| `--verbose` | false | Show detailed output or return raw API response |

### `aisee action-detail <action-id>`
Show the full details of a single action task: metadata, description, and all solution steps.

```bash
aisee action-detail abc-123
aisee action-detail abc-123 --format markdown
aisee action-detail abc-123 --format json
```

| Flag | Default | Description |
|---|---|---|
| `<action-id>` | required | Action task ID |

### `aisee action-suggest <action-id>`
Get detailed AI-generated implementation suggestions for an action.

```bash
aisee action-suggest abc-123
aisee action-suggest abc-123 --content-days 3
```

| Flag | Default | Description |
|---|---|---|
| `<action-id>` | required | Action ID |
| `--content-days <n>` | *server default* | Days of ready-to-publish social posts to generate (1 per day). `0` disables them — which also leaves `aisee action-post` with nothing to post. |

Two outcomes are reported rather than treated as errors: **`unnecessary`** (the item is already at
or above its target score) and **`unsupported`** (the gap has no playbook coverage yet and needs
manual review). Neither runs the model, and neither is charged.

### `aisee action-post <action-id>`
Create social media posts from an action's implementation suggestions. Discovers target channels automatically from the product configuration.

```bash
aisee action-post abc-123
```

| Flag | Default | Description |
|---|---|---|
| `<action-id>` | required | Action ID |
| `--channel-id <id>` | — | Only post to this channel ID |


---

## Post

### `aisee post create`
Create a new social media post.

```bash
aisee post create --channel <channel id> --text "Hello world"
aisee post create --channel <channel id> --file ./draft.md --schedule 2026-05-01T10:00:00Z
aisee post create --channel <channel id> --text "Caption" --image ./photo.jpg
```

| Flag | Default | Description |
|---|---|---|
| `--channel <id>` | required | Channel ID|
| `--text <content>` | — | Direct post text |
| `--file <path>` | — | Path to a Markdown file (alternative to `--text`) |
| `--schedule <iso>` | — | Scheduled publication time (ISO 8601) |
| `--draft` | false | Create as a draft; commit it later with `aisee post publish <id>` |
| `--image <path>` | — | Local image file to attach |

**Platform-specific flags.** Some platforms require a value that cannot be derived from the post
body. Passing one that the target platform does not use is harmless.

| Flag | Required by | Description |
|---|---|---|
| `--title <text>` | *(optional everywhere)* | Overrides the title taken from the first line of the post |
| `--subreddit <name>` | reddit | Target subreddit, with or without `r/` |
| `--board <id>` | pinterest | Board ID |
| `--channel-target <id>` | discord, slack, wrapcast | Target channel ID |
| `--publication <id>` | hashnode | Publication ID |
| `--tags <a,b>` | hashnode | Tag labels (also accepted by devto, medium, youtube) |
| `--list <id>` | listmonk | Mailing-list ID |
| `--community <id>` | lemmy | Numeric community ID |

> **Not every post is sent by the server.** Platforms routed to the browser extension
> (`hackernews`, `medium`, `quora` by default, and possibly `x`, `reddit`, `linkedin`, `devto`
> depending on the deployment) are published from your own signed-in Chrome by the AISee browser
> extension — not from the backend. Those posts stay in `QUEUE` until that browser runs. The
> command reports the resolved send path, and `aisee post pending` counts what is waiting.

### `aisee post list`
List recent posts with optional status filter.

```bash
aisee post list
aisee post list --state DRAFT --size 20
aisee post list --format json
```

| Flag | Default | Description |
|---|---|---|
| `--state <s>` | — | `DRAFT`, `QUEUE`, `PUBLISHED`, `ERROR` |
| `--page <n>` | 1 | Page number |
| `--size <n>` | 10 | Items per page (max 100) |
| `--verbose` | false | Show detailed output or return raw API response |

### `aisee post dashboard`
View social media engagement and traffic metrics.

```bash
aisee post dashboard
aisee post dashboard --period 30d --channel x
```

| Flag | Default | Description |
|---|---|---|
| `--period <p>` | `7d` | `24h`, `7d`, `30d`, `90d` — translated to a whole-day date window in your timezone |
| `--channel <a,b>` | — | Comma-separated platform names (e.g. `x,reddit`) |
| `--integration <a,b>` | — | Comma-separated integration IDs |

### `aisee post publish <id>`
Commit a **draft** post to the send queue (`DRAFT` → `QUEUE`). This is where the send path
(extension vs backend API) is resolved and recorded.

```bash
aisee post create --channel <channel id> --text "Hello" --draft
aisee post publish abc-123
aisee post publish abc-123 --publish-method api
aisee post publish abc-123 --retry
```

| Flag | Default | Description |
|---|---|---|
| `<id>` | required | Post ID |
| `--retry` | false | Retry a post in `ERROR` state instead of committing a draft. Requires a connected account. |
| `--publish-method <m>` | — | Force `extension` or `api`; omit to let the backend resolve it |

A post already in `QUEUE` or `PUBLISHED` is reported as a no-op, not as a fresh publish. Committing
a post in `ERROR` fails with `INVALID_STATE` — use `--retry` for those.

### `aisee post pending`
Count posts waiting for the browser extension to publish. Organization-wide: the underlying
endpoint takes no filters.

```bash
aisee post pending
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

### `aisee channels select <url>`
Bind social media channels to a product, or view the current channel configuration.

Used by `aisee action-post` to determine which channels to publish to when running analysis-driven posting.

**View current config** (no `--channels` flag):
```bash
aisee channels select https://example.com
aisee channels select https://example.com --format json
```

**Bind channels to a product:**
```bash
aisee channels select https://example.com --channels <id1>,<id2>
```

| Flag | Default | Description |
|---|---|---|
| `<url>` | required | Product website URL |
| `--channels <ids>` | — | Comma-separated channel IDs to bind. Omit to show current config. |

> Channel IDs come from `aisee channels list`.

---

## Config

### `aisee config list`
Show current configuration values and their sources.

```bash
aisee config list
aisee config list --format json
```

### `aisee config set <key> <value>`
Update a configuration value in `~/.config/aisee/config.yaml`.

```bash
aisee config set analysis_api_url https://api.aisee.live
aisee config set auth_api_url     https://api-auth.aisee.live
```

| Argument | Description |
|---|---|
| `<key>` | Config key to update: `auth_api_url`, `analysis_api_url`, `post_agent_api_url`, `app_url` |
| `<value>` | New value for the config key |

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
| `tui` | Rich terminal UI with colour and layout |
| `markdown` | Markdown source — pipe to a renderer or file |
| `csv` | Spreadsheet export |
| `yaml` | Config/document output |
| `jsonl` | Streaming / log ingestion |

Use `--fields` to select specific fields:

```bash
aisee report https://example.com --format json --fields result.total_score,status
```
