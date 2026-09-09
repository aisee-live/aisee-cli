# AISee CLI — Command Reference

## Global Options

Available on every command. Built-in apcore options are hidden by default; pass `--all-options` to reveal them (`aisee <command> --help --all-options` for a command, `aisee --help --all-options` for the summary at the root).

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
| `--presence-models <a,b>` | *template default* | `provider/model` IDs for the AI-presence analyzer |
| `--competitor-models <a,b>` | *template default* | `provider/model` IDs for the competitor analyzer |
| `--no-wait` | — | Return immediately after submitting (default: wait for results) |

Each `--*-models` flag is the **complete desired set** for that analyzer group, not an addition:
models left out of the list are removed from the run. Omit a flag to keep the subscription
template's default for that group. Run `aisee models` for the valid IDs.

### `aisee models`
Show the analyzer models an analysis runs with — the subscription template's defaults, and
optionally what a product's most recent analysis actually used.

```bash
aisee models
aisee models --project https://example.com
```

| Flag | Default | Description |
|---|---|---|
| `--project <ref>` | — | Product URL, domain or ID — adds that product's last-run models |

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

For a platform with no connected account, a post is still created when the browser extension can
publish that platform — it carries the platform instead of an account and is sent from your Chrome.
Platforms with neither a connected account nor an extension path are skipped and named.

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
| `--project <ref>` | — | Product URL, domain or ID to attribute the post to |
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
| `--project <ref>` | — | Only posts attributed to this product |
| `--channel <a,b>` | — | Comma-separated platform names |
| `--source <a,b>` | — | Comma-separated sources: `calendar`, `chat`, `engage` |
| `--plan <id>` | — | Only posts generated by this operation plan |
| `--sort <field>` | `publishDate` | `publishDate`, `createdAt`, `updatedAt`, `state` |
| `--order <dir>` | `desc` | `asc` or `desc` |
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
| `--project <ref>` | — | Scope analytics to one product |
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

## Operation Plans

An operation plan turns a completed analysis into a date-ranged publishing schedule. Generated posts
land in `DRAFT`; committing them to the send queue is a separate, explicit step.

### `aisee plan create`
Generate a plan from a completed analysis. Generation is asynchronous — the command polls until the
plan settles.

```bash
aisee plan create --project https://example.com --start 2026-10-01T09:00:00Z --end 2026-10-14T09:00:00Z --platforms x,reddit
aisee plan create --project https://example.com --start ... --end ... --platforms x --preview
```

| Flag | Default | Description |
|---|---|---|
| `--project <ref>` | required | Product URL, domain or ID |
| `--from-task <id>` | *latest completed analysis* | Analysis task to build the plan from |
| `--start <iso>` | required | Plan start (ISO 8601, must be in the future) |
| `--end <iso>` | required | Plan end (must be after `--start`) |
| `--platforms <a,b>` | required | Platforms to plan for |
| `--keywords <a,b>` | *from the product snapshot* | Engage keywords for the plan's reply policies |
| `--preview` | false | Generate a preview without billing or persisting anything |

`--from-task` has no server-side default — the API requires a task ID — so when it is omitted the
CLI resolves the product's latest **completed** analysis and prints which one it picked.

`--preview` runs generation inline and returns a plan with `status: PREVIEW` and no ID. Nothing is
persisted and no credit is deducted, so there is nothing to poll: the command prints the preview and
exits. (The LLM call still runs, at real cost to the platform.)

Without `--preview` the plan settles on `READY`, `FAILED` or `BILLING_FAILED`. The two failure
states are terminal — nothing retries them — so the command reports the reason and exits non-zero.

The output lists the resolved send path per platform, so a plan that depends on the browser
extension is visible before you commit credits.

### `aisee plan status`
Show the project's active plan and its posts.

```bash
aisee plan status --project https://example.com
aisee plan status --project https://example.com --plan-id <id>
```

| Flag | Default | Description |
|---|---|---|
| `--project <ref>` | required | Product URL, domain or ID |
| `--plan-id <id>` | *the active plan* | Inspect a specific plan instead |

Having no active plan is a normal state, not an error — the command says so and exits cleanly.

### `aisee plan posts`
List the posts a plan generated.

```bash
aisee plan posts --project https://example.com
aisee plan posts --project https://example.com --all-plans --state DRAFT
```

| Flag | Default | Description |
|---|---|---|
| `--project <ref>` | required | Product URL, domain or ID |
| `--plan-id <id>` | *the active plan* | Only posts from this plan |
| `--all-plans` | false | Every plan-generated post for the project |
| `--state <s>` | — | `DRAFT`, `QUEUE`, `PUBLISHED`, `ERROR` |
| `--page <n>` / `--size <n>` | 1 / 20 | Pagination |

### `aisee plan activate`
Commit the project's active plan to the send queue (`DRAFT` → `QUEUE`).

```bash
aisee plan activate --project https://example.com
aisee plan activate --project https://example.com --platforms x,reddit
```

| Flag | Default | Description |
|---|---|---|
| `--project <ref>` | required | Product URL, domain or ID |
| `--platforms <a,b>` | *the project's current set* | **Complete** set of platforms to publish to |
| `--publish-method <m>` | — | Force `extension` or `api` for this batch |

> **`--platforms` replaces, it does not add.** The API treats this field as the complete enabled set:
> any platform left out is switched **off**, and an empty set switches scheduled publishing off
> entirely. When you omit the flag the CLI reads the project's current set and sends it back
> unchanged, and when you pass one it names any platform that is about to be turned off. If the
> project has no platforms enabled yet, the command refuses rather than writing an empty set.

The plan itself is never named by the client — the API resolves the project's active plan
server-side, so a stale or wrong plan ID cannot be sent.

---

## Channels

### `aisee channels list`
List all connected social media accounts and their status.

```bash
aisee channels list
aisee channels list --format json
```

A row that carries `browser_session` is published from your signed-in Chrome by the AISee browser
extension, not by the server. On those rows `connected` is the wrong field to read — it only tracks
the server-side OAuth credential, and a channel with a stale token still posts through the browser
perfectly well. Read `browser_session` instead:

| Value | Meaning |
|---|---|
| `matched` | The browser is signed into this account — posts can go out |
| `not_matched` | Checked recently, and the browser is signed into a different account (or none). `browser_signed_in_as` names who it is |
| `stale` | Reported once, too long ago to act on — usually the browser has been closed since |
| `unknown` | Never reported: an extension too old to report, or one that has not run its pass here yet |

On `quora` and `devto` the sign-in probe is less reliable (both serve signed-out visitors the same
cookies), so `not_matched` there is worth checking by hand.

Rows without `browser_session` are published by the server, where the browser session has no
bearing on whether a post goes out.

### `aisee channels add <platform>`
Connect a new social media account via browser OAuth.

```bash
aisee channels add x
aisee channels add linkedin-page
```

Supported platforms: `x`, `reddit`, `linkedin`, `linkedin-page`, `instagram`, `instagram-standalone`,
`facebook`, `youtube`, `tiktok`, `pinterest`, `threads`, `mastodon`, `bluesky`, `medium`, `devto`,
`hashnode`, `wordpress`, `discord`, `slack`, `telegram`, `dribbble`, `kick`, `twitch`, `lemmy`,
`listmonk`, `gmb`, `wrapcast`, `nostr`, `vk`, `quora`, `hackernews`

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

**Two stores are kept in sync.** aisee-core holds the list on the product (`action-post` reads it),
while Postiz holds one binding row per channel (the dashboard's channel counts read those). Passing
`--channels` reconciles both: it binds what is new, **unbinds what you left out**, and writes the
core list. Every step is reported, and a partial failure is reported rather than swallowed.

Viewing the config shows both sides — an `In aisee-core` and an `In Postiz` column — so a binding
that exists on only one side is visible instead of silently skewing the dashboard.

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

> **Defaults differ between command groups.** `post` commands render a table on a
> TTY and JSON when piped; every other command renders TUI on a TTY and a table
> when piped. Pass `--format` explicitly in scripts rather than relying on either.

## Failures

Some commands act on several items at once — `post publish`, `plan activate` and
`channels select` each touch a batch, and part of a batch can fail while the rest
succeeds.

When that happens the command **exits non-zero regardless of `--format`**, and the
per-item breakdown is reported as structured `details` on stderr rather than mixed
into the successful output on stdout:

```
Error: 1 of 2 post(s) could not be committed.

  Details:
    queued: p2
    post p1: INVALID_STATE: Cannot schedule a post in state ERROR — only DRAFT posts can be committed; use --retry for a failed post

  Exit code: 1
```

The same breakdown in a machine format:

```json
{"error":true,"code":"UNKNOWN","message":"1 of 2 post(s) could not be committed.","exit_code":1,
 "details":{"queued":"p2","post p1":"INVALID_STATE: Cannot schedule a post in state ERROR — ..."}}
```

`details` is always a flat map of scalar values, so it reads the same in both.
A script should check the exit code and read `details` from stderr; stdout carries
output only when the whole batch succeeded.
