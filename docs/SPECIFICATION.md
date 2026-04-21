# AISEE CLI - Software Specification

**Version:** 1.0.0  
**Status:** Draft  
**Owner:** AISee Engineering  
**Language:** English

---

## 1. Introduction
AISEE CLI is a high-performance command-line interface designed to bridge the gap between AI-driven SEO analysis (AISee Orchestrator) and multi-channel content distribution (Postiz). It serves as a professional tool for marketers and developers to automate AEO (Answer Engine Optimization) workflows directly from their terminal.

## 2. Design Principles
- **Thin Client Philosophy:** The CLI should remain lightweight, delegating complex logic to the `aisee-orchestrator`.
- **Developer First:** Prioritize speed, clear error messages, and piping support (JSON output).
- **Secure by Default:** Use standard OAuth2/OIDC flows; never store passwords locally.
- **Convention over Configuration:** Sensible defaults for all commands, but fully customizable via YAML.

## 3. Technical Architecture
### 3.1 Stack
- **Runtime:** [Bun](https://bun.sh) (Selected for its speed and built-in SQLite/HTTP support).
- **Language:** TypeScript (Strict typing for robust command definitions).
- **Framework:** 
  - `apcore-typescript`: Core registry and module patterns.
  - `apcore-cli-typescript`: Command parsing and CLI layout.
  - `apcore-toolkit-typescript`: Shared utilities for logging and I/O.
- **Formatting/Validation:** `Zod` for runtime input validation, `YAML` for configuration.

### 3.2 System Components
- **CLI Core:** Handles routing, registry management, and global error handling.
- **Service Clients:**
  - `AnalysisClient`: Communicates with `aisee-orchestrator`.
  - `PostClient`: Communicates with `post-agent` (Postiz-app).
- **Storage:** Local configuration at `~/.config/aisee/config.yaml`.

---

## 4. Authentication Flow (RFC 8628)
The CLI implements the **OAuth 2.0 Device Authorization Grant** to provide a seamless login experience without requiring the user to type credentials in the terminal.

### 4.1 Process
1. **Initiate:** User runs `aisee auth login`.
2. **Device Code:** CLI requests a device code from the Auth Server.
3. **User Action:** CLI prints a verification URL and user code. It automatically attempts to open the browser using the `open` package.
4. **Polling:** The CLI enters a background polling state (with exponential backoff and ora spinner).
5. **Completion:** Once the user authorizes in the browser, the Auth Server returns an `access_token` and `refresh_token`.
6. **Persistence:** Tokens are securely stored in the config directory.

### 4.2 Refresh & Retry
- **Automatic Refresh:** Before each API call, the CLI checks token expiry. If expired, it uses the `refresh_token` to obtain a new session.
- **Retry Logic:** Implements transient error retries (3 attempts) for network-related failures.

---

## 5. Configuration Schema
Configuration follows a strict priority hierarchy:
1. **Command Line Arguments** (highest)
2. **Environment Variables** (e.g., `AISEE_API_KEY`)
3. **Config File** (`~/.config/aisee/config.yaml`)
4. **Internal Defaults** (lowest)

### 5.1 YAML Schema
```yaml
# ~/.config/aisee/config.yaml
auth_api_url: "https://api-auth.aisee.live"
analysis_api_url: "https://api.aisee.live"
post_agent_api_url: "https://api-post.aisee.live"
```


---

## 6. Command Reference
The CLI provides 22 logical commands organized into 5 primary modules.

### 6.1 Auth Module
| Command | Description |
|---------|-------------|
| `auth login` | Starts the Device Authorization Flow. |
| `auth logout` | Revokes and deletes local tokens. |
| `auth whoami` | Displays current identity and token status. |

### 6.2 Analysis Module (aisee-orchestrator client)
| Command | Description |
|---------|-------------|
| `analysis scan` | Triggers a site-wide scan for AEO/SEO data. |
| `analysis report` | Fetches the latest comprehensive report. |
| `analysis report ai-presence` | Shows how AI agents (Perplexity, ChatGPT) perceive the brand. |
| `analysis report seo` | Standard SEO metrics and health scores. |
| `analysis report strategy` | High-level strategic recommendations based on AI data. |
| `analysis report mentions` | Recent brand mentions and competitor positioning. |
| `analysis actions list` | Lists pending optimization tasks. |
| `analysis actions suggest` | Requests an AI-generated implementation plan for a task. |
| `analysis actions post` | Forwards a suggested action to the Postiz draft queue. |

### 6.3 Post Module (Postiz-app client)
| Command | Description |
|---------|-------------|
| `post create` | Interactive prompt to create a new social media post. |
| `post list` | Lists recent posts and their status (draft, scheduled, sent). |
| `post dashboard` | Displays engagement stats and pipeline overview. |
| `post publish` | Immediately sends a draft to selected channels. |
| `post schedule` | Schedules a post for a specific future timestamp. |

### 6.4 Channels Module
| Command | Description |
|---------|-------------|
| `channels list` | Lists all connected social media integrations. |
| `channels add` | Guides user to add a new channel (LinkedIn, Twitter, etc.). |
| `channels remove` | Disconnects a social media channel. |

### 6.5 Config Module
| Command | Description |
|---------|-------------|
| `config list` | Prints the effective configuration (merged results). |
| `config set` | Updates a specific key in the YAML config file. |

---

## 7. Error Handling
- **User Errors (4xx):** Displayed with clear "Actionable" messages in `chalk.yellow`.
- **System Errors (5xx):** Logged to file, displayed as "Service Unavailable" in `chalk.red`.
- **Validation Errors:** Zod errors are formatted into a human-readable list of missing/invalid parameters.

## 8. Development Roadmap
- [ ] Phase 1: Implementation of `apcore` registry and Auth flow.
- [ ] Phase 2: Orchestrator integration (`analysis` commands).
- [ ] Phase 3: Postiz integration (`post` & `channels` commands).
- [ ] Phase 4: Interactive TUI components for dashboards.
