# AISEE CLI Command Reference

This document provides a detailed guide for all commands available in the AISEE CLI.

## Global Options

The following flags are available for most commands:

- `--format <table|json|csv>`: Set the output format (default: `table`).
- `--quiet`: Suppress non-essential output, returning only raw data.
- `--help`: Show help information for a command.
- `--version`: Display the CLI version.

---

## 1. Authentication (`auth`)

Manage your identity and session.

### `aisee auth login`
Initiate the Device Authorization Flow.
- **Action:** Opens the browser and prompts for a user code.
- **Output:** Login status and user information.

### `aisee auth logout`
Clear local credentials and revoke the current session.
- **Action:** Deletes `~/.config/aisee/credentials.json`.

### `aisee auth whoami`
Display the currently logged-in user and remaining credits.

---

## 2. Analysis (`analysis`)

Interact with the AISee Orchestrator to scan and audit websites.

### `aisee scan <url>`
Trigger a comprehensive site audit.
- **Flags:**
  - `--platform <names>`: Specify AI platforms (e.g., `anthropic,google`).
  - `--rescan`: Force a fresh analysis even if a recent one exists.

### `aisee report <url> [section]`
View the analysis report for a specific URL.
- **Sections:** `ai-presence`, `competitor`, `strategy`, `seo`, `mentions`.
- **Flags:**
  - `--version <v>`: Fetch a specific historical version (e.g., `v2.0`).
  - `--history`: List all available historical versions for this URL.

### `aisee actions <url>`
List all actionable optimization tasks recommended for the site.
- **Flags:**
  - `--module <name>`: Filter by module (e.g., `strategy`, `competitor`).

### `aisee actions suggest <url> <task-id>`
Get a detailed AI-generated implementation plan for a specific task.

### `aisee actions post <url> <task-id>`
Convert a task suggestion into a social media post draft.
- **Flags:**
  - `--channel <id>`: Target social media channel ID.

---

## 3. Post Agent (`post`)

Manage social media content and scheduling.

### `aisee post create`
Create a new social media post.
- **Flags:**
  - `--text "content"`: Direct text input.
  - `--file <path>`: Load content from a Markdown file.
  - `--channel <id>`: Target channel.
  - `--schedule <timestamp>`: Set a future publication date.
  - `--media <path>`: Attach a local image or video.

### `aisee post list`
List recent posts and their delivery status.
- **Flags:**
  - `--status <scheduled|sent|draft>`: Filter by status.
  - `--channel <id>`: Filter by channel.

### `aisee post dashboard`
Display social media performance metrics.
- **Flags:**
  - `--period <24h|7d|30d>`: Data lookback window.

---

## 4. Channels (`channels`)

Manage your social media integrations.

### `aisee channels list`
List all connected social media accounts.

### `aisee channels add <platform>`
Connect a new social media account.
- **Action:** Opens the browser for OAuth authorization with the platform.

### `aisee channels remove <id>`
Disconnect a specific channel.

---

## 5. Configuration (`config`)

Manage CLI settings and environment URLs.

### `aisee config list`
List all effective settings and their sources (Config File, Env Var, or Default).

### `aisee config set <key> <value>`
Update a setting in the local `config.yaml`.
- **Keys:** `authApiUrl`, `analysisApiUrl`, `postAgentApiUrl`.

---

## 6. Example Configuration

```yaml
auth_api_url: https://api-auth.aisee.live
analysis_api_url: https://api.aisee.live
post_agent_api_url: https://api-post.aisee.live
```
