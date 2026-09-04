# AISee CLI — Backend API Alignment Plan

**Status:** Approved — Phase 1 landed; Phases 2-3 pending
**Date:** 2026-09-03
**CLI version:** 0.6.1

**Approved constraints:**
1. **Existing APIs are the contract. CLI-side changes only** — no backend change unless a gap is
   genuinely unfixable from the client. *(Audit result: nothing below requires a backend change.)*
2. Publishing / replying has moved to a **browser-extension send path**. Design around it.
3. Both `action-post` **and** a new `aisee plan` command group are in scope.

**Sources audited:**
- `../aisee-core/aisee_orchestrator` — FastAPI, routers in `api/__init__.py`
- `../postiz-app/apps/backend/src` — NestJS controllers + `libraries/nestjs-libraries/src/dtos`
- `../aisee-browser-extension` — `src/utils/executor/{scheduler,publish.runner}.ts`, `src/utils/post-publish/queue.ts`

**v3 changelog (all five findings accepted):** F6 rewritten around the missing DRAFT creation path
and the real state machine; F5 upgraded from upsert to full reconciliation; §6 adds a concrete
`--project` input design and fixes the Phase 1/2 ordering contradiction; N8 replaced by a
per-platform, per-field table — the audit found **four platforms the CLI already breaks today**, now
promoted to P0 as F8; F1's `ValidationPipe` root cause corrected (it was stated backwards).

**v4 changelog (all four findings accepted):** §1's extension routing table corrected — `wordpress`
and `listmonk` are **not** extension-routed (I had read a grouping comment in the provider list
instead of the `extensionPublish` flag); `--project` removed from `post pending`, which has no
project-scoped endpoint; Phase 3 `plan activate` now reads and echoes the complete `platforms` set
(it is not a delta — omissions disable platforms); Phase 3 `plan create` now defines `--from-task`
resolution and terminates `--dry-run` without polling.

---

## 1. The single most important change: the CLI cannot publish

**`QUEUE` in the database is now the only source of truth for "should be sent", and exactly one of
two executors sends it**, decided once and recorded in `Post.publishMethod`:

| `publishMethod` | Executor | Applies when |
|---|---|---|
| `API` | Temporal workflow, server-side provider write API | Platform has a usable write API **and** a bound OAuth account |
| `EXTENSION` | **The user's own Chrome**, in-browser with their platform session | Platform has no server write API (hackernews / medium / quora), **or** an operator routed a dual-capable platform (x / reddit / linkedin / devto) to the extension |

**Exactly which platforms are extension-routed — verified against the flag, not the comments.**
`isExtensionPublishProvider(id)` is `EXTENSION_PUBLISHABLE.has(id) && (provider.extensionPublish || ENV_EXTENSION_PUBLISH_PLATFORMS.includes(id))`:

- **Ceiling** — `EXTENSION_PUBLISHABLE_PLATFORMS = [x, reddit, linkedin, hackernews, medium, quora, devto]`. Nothing outside this can ever be extension-routed.
- **Default** — `extensionPublish = true` is set on exactly **three** providers: `hackernews`,
  `medium`, `quora`.
- **Operator-extendable** — the `EXTENSION_PUBLISH_PLATFORMS` env allowlist can add any of the
  remaining ceiling members (`x`, `reddit`, `linkedin`, `devto`). The CLI cannot see this env var.

> `wordpress` and `listmonk` are **not** extension-routed on either count: neither sets
> `extensionPublish`, and neither is in the publishable ceiling. A comment in
> `integration.manager.ts` lists them under *"Extension-published (no server write API)"* alongside
> hackernews/quora — that grouping comment is stale and contradicts the flag. **Read the flag.**

**Consequence for the CLI: never hardcode this set.** The default set, the env allowlist and the
per-org "is an account bound?" half are all server-side. `GET /posts/publish-methods` returns the
resolved answer per platform using the same `resolvePublishMethod` the commit enforces — it is the
only correct source, and it is why F7/Phase 2 caches it rather than shipping a table.

For an extension-routed post the backend **never makes a provider call**. `startWorkflow` explicitly
diverts: *"Leave the Post in QUEUE; the browser extension's publish-due loop claims it."* The
extension pulls `POST /posts/publish-due` on its own background alarm (`aisee-publish-poll`, armed
only while the extension holds a session) — so it is **unattended**: Chrome running + extension
signed in is enough; the web app need not be open.

### What this means for a headless CLI

- `aisee post create` / `aisee action-post` on any platform the server resolves to `EXTENSION`
  — `hackernews`, `medium`, `quora` by default, possibly also `x`, `reddit`, `linkedin`, `devto`
  depending on the deployment's env allowlist — **queue** a post; they do not publish it. With no signed-in extension the post sits in
  `QUEUE` until the 7-day stale sweep flips it to `ERROR` with a misleading cause.
- This is the architecture, not a bug. **The CLI's job is to say so, accurately.** Every queueing
  command reports the resolved `publishMethod` and, for `EXTENSION`, states plainly that delivery
  depends on the user's browser.
- `GET /posts/publish-methods` (org-scoped, side-effect-free, *"fetch it once and cache it"*) gives
  the resolved answer per platform. `GET /posts/publish-due/count` gives the current backlog.

---

## 2. Method & caveat

Every finding was verified against the route handler **and** its DTO upstream. Route *paths* are
largely intact; the drift is in query/body parameters, response contracts, and the new
project-scoping and publish-method concepts — which is why the CLI mostly fails **silently**.

`docs/openapi/*.json` are snapshots from **2026-05-09** and predate nearly all of this. Do not use
them as the reference until re-synced (`bun run sync-openapi`).

---

## 3. P0 — broken or silently wrong today

### F1. `post dashboard --period` is a no-op; the summary is always all-time, org-wide
- CLI: `GET /dashboard/summary?period=<24h|7d|30d|90d>` — [post-agent.ts:199](../src/clients/post-agent.ts#L199)
- API: `DashboardSummaryQueryDto` accepts `projectId`, `startDate`, `endDate`, `integrationId[]`,
  `channel[]`. There is no `period` field.
- **Root cause:** the DTO does not declare `period` and neither the controller nor
  `DashboardService.getSummary` ever reads it, so the flag has no effect. *(It is not the
  `ValidationPipe` that discards it — `whitelist` is the option that strips unknown properties, and
  it is **not** enabled here (`main.ts` sets only `transform: true`), so the value is actually
  carried through on the query object and simply never consumed. Stating this backwards would send
  the next person debugging into the pipe config.)*
- Secondary: `postDashboardModule.inputSchema` declares a `channel` option `execute()` never sends.
- **Fix (CLI):** translate `--period` into a `startDate`/`endDate` window; actually send `channel`;
  add `--integration`. *(Project scoping is deliberately Phase 2 — see §6.)*

### F2. `action-suggest` hardcodes `content_days=0`, making `action-post` structurally impossible
- CLI: `POST /action/{id}/generate-tasks?content_days=0` — [analysis.ts:247,253](../src/clients/analysis.ts#L247)
- API default is `settings.ACTION_TASK_CONTENT_DAYS` (**1**); the parameter's docstring says
  *"Set to 0 to disable CONTENT-task generation."*
- `actionsPostModule` then filters `solution_data` for `type === "CONTENT"` and throws *"No unposted
  CONTENT tasks found"* — always, because the CLI told the server not to generate any.
- **Fix (CLI):** stop sending `content_days`; expose `--content-days <n>` as an explicit override.

### F3. `action-suggest` polls the wrong endpoint and misreads the status contract
- CLI: POST → poll `GET /task/detail/{task_id}` → **re-POST** `generate-tasks` — [analysis.ts:221](../src/clients/analysis.ts#L221)
- API: `GET /action/{action_id}/generated-tasks` is the read-only, lock-free polling endpoint. POST
  returns `completed | processing | unnecessary | unsupported`, `failed` envelopes carrying a
  `terminal` flag, plus `402` insufficient credit, `429` concurrency, `403 PRODUCT_INACTIVE`.
- The re-POST is not a double-charge (`SELECT … FOR UPDATE` + in-flight sentinel), but
  `unnecessary` / `unsupported` — normal business outcomes — render as generic failures.
- **Fix (CLI):** POST once → on `processing`, poll `generated-tasks` → render terminal statuses as
  informational → map 402/429/403 to actionable messages.

### F4. CLI-created posts are invisible to every project-scoped view
- `CreatePostDto` gained `projectId` (opaque `aisee-core.products.id`), `source`
  (`calendar|chat|engage`), per-post `publishMethod` and `providerIdentifier`.
- `GET /posts/list`, all five `/dashboard/*`, operation plans and Engage filter on `Post.projectId`.
  It stays optional only for legacy back-compat (`project-scoped-post-engage-design.md` §11:
  *"Require `projectId` for migrated writes"*).
- The CLI sends none of it — [post-agent.ts:129-176](../src/clients/post-agent.ts#L129).
- **Fix (CLI):** thread the product id through `post create` and `actions.post`; send `source: 'calendar'`.

### F5. `channels select` binds in aisee-core only, and a naive dual-write would leak stale bindings
- CLI writes `product.config.channels` via `POST /product/config/channles` — still valid, and it is
  a **full replace** (`product.config["channels"] = channles`), so removing a channel from the
  `--channels` list removes it from core.
- Postiz owns project↔channel binding in `IntegrationProject`:
  `POST /integrations/integration-project` (upsert), `GET /integrations/integration-project/list?projectId=`,
  `DELETE /integrations/integration-project?integrationId=&projectId=`.
- `channel_count` / `channel_connected_count` / `channels_by_platform` on `/dashboard/summary` read
  `IntegrationProject`. A product configured only via the CLI reads as having zero channels.
- **Fix (CLI): dual-write with reconciliation, not upsert.** Because the core side is a full
  replace and the Postiz side is per-binding, upsert-only would leave a removed channel bound in
  Postiz and still counted on the dashboard. The write must be:
  1. `GET /integrations/integration-project/list?projectId=` → current bindings
  2. `POST` upsert for each id in the new set
  3. **`DELETE` for each id in `current \ new`**
  4. `POST /product/config/channles` with the new set
  5. Report per-side outcome; never a silent partial success.

  Both endpoints already exist, so this stays within constraint 1.

### F6. `post publish` has never had a working path: no DRAFT is ever created, and it calls retry
Three separate defects that only make sense together:

1. **The CLI cannot create a DRAFT.** `CreatePostDto.type` is `'draft' | 'schedule' | 'now'`, but
   `postAgentClient.createPost` hardcodes `type: data.schedule ? "schedule" : "now"` —
   [post-agent.ts:160](../src/clients/post-agent.ts#L160). There is no `--draft`.
2. **`POST /posts/schedule` only commits DRAFTs.** Verified in `PostsService.schedulePosts`:
   - `state === 'DRAFT'` → resolve + stamp `publishMethod`, flip to `QUEUE`. The real commit.
   - `state === 'QUEUE' | 'PUBLISHED'` → **idempotent no-op success**, returns the stored
     `publishMethod`. It does *not* publish anything.
   - anything else (i.e. `ERROR`) → `{ code: 'INVALID_STATE' }`.
   - Returns **per-item `{ scheduled[], failed[] }`** — a partial failure is not an exception.
3. **`POST /posts/{id}/retry` is ERROR-only.** `PostsService.retryPost` throws
   `'Only failed posts can be retried'` unless `state === 'ERROR'`, and additionally requires a
   bound, enabled, non-`refreshNeeded` integration — so an account-less extension post can never
   be retried.

   Net effect today: `aisee post publish <id>` on anything the CLI itself created (QUEUE / PUBLISHED)
   throws *"Only failed posts can be retried"*. It is a retry command wearing a publish name.

- **Fix (CLI):**
  - add `post create --draft` (mutually exclusive with `--schedule`) so a DRAFT can exist;
  - `post publish <id>` → `POST /posts/schedule`, documented as **commit a draft to the send queue**;
    render `scheduled` / `failed` per item; report the resolved `publishMethod` per post; do **not**
    report a QUEUE/PUBLISHED no-op as "published";
  - `post publish --retry <id>` → `POST /posts/{id}/retry`, documented as **ERROR-only**, with the
    integration preconditions surfaced as their own messages.

### F7. The CLI never tells the user a post is waiting on their browser
- For `type: 'now'` the API returns `{ postId, integration, state, releaseURL, publishMethod }`. The
  backend comment is explicit: a post-now that comes back `QUEUE` **was not sent** — either
  extension-routed or a Temporal timeout — *"the caller cannot tell those apart from `state` alone,
  and they need different things said to the user — so report the decision."*
- The CLI drops `publishMethod`, and for `type: 'schedule'` (where the API returns **no** `state`)
  fabricates `state: "QUEUE"` — [post-agent.ts:170](../src/clients/post-agent.ts#L170).
- **Fix (CLI):** surface `publishMethod` on create / list / publish; stop fabricating state; add the
  extension-dependency notice; add `aisee post pending` over `GET /posts/publish-due/count`.

### F8. `buildPlatformSettings` already sends invalid values for four platforms it claims to support
Promoted from P1 after a per-field audit. Required-and-empty is a hard 400, so
`aisee post create --channel <id>` fails outright on these today:

| Platform | CLI sends | DTO requirement | Verdict |
|---|---|---|---|
| `discord` | `{ channel: "" }` | `DiscordDto.channel` `@IsDefined @MinLength(1)` | **400** |
| `slack` | `{ channel: "" }` | `SlackDto.channel` `@IsDefined @MinLength(1)` | **400** |
| `reddit` | `subreddit[0].value.subreddit = ""` | `RedditSettingsDtoInner.subreddit` `@MinLength(2)` | **400** |
| `pinterest` | `{ board: "" }` | `PinterestSettingsDto.board` `@MinLength(1, 'Board is required')` | **400** |

These need a **user-supplied id** the CLI has no flag for. See N8 for the full matrix and the
proposed flags.

---

## 4. P1 — capabilities the CLI cannot reach

| # | Capability | Upstream surface | CLI today |
|---|---|---|---|
| N1 | Analyzer model selection | `GET /task/analyzer-models[?product_id=]`; `model_overrides:{ai_presence_analyzer[],ai_competitor_analyzer[]}` on `/task/analyze-product` and `/analyze-task` | none |
| N2 | Execution / minor-version history | `GET /task/executions/{task_id}`; `GET /task?show_minor_tasks&original_task_id&show_triggered_task_code` | `report --history` sees root tasks only |
| N3 | Operation plans | `POST /projects/{projectId}/operation-plans` (async → poll `GET /operation-plans/{id}`), `POST /projects/{id}/automation/publishing`. aisee-core mirrors `operation_plan_id`/`operation_plan_status` — already in every `build_task_result` payload the CLI receives | ignored entirely |
| N4 | Posts list filters | `projectId`, `operationPlanId`, `hasOperationPlan`, `source`, `channel`, `integrationId`, `view`, `sortBy`, `sortOrder` | `state`, `page`, `pageSize` only |
| N5 | Lifecycle / billing gates | `403 PRODUCT_INACTIVE`, `403` product-limit, tier-template gate, `402` insufficient credit, `429` concurrency | raw `[403] …` text |
| N6 | Product onboarding review | `POST /product/preview`, `POST /product/create-with-review` | `scan` auto-creates via `analyze-product` (still works); no preview |
| N7 | Channel platform list | `VALID_CHANNELS` | `channelAddModule` enum missing discord, slack, telegram, wordpress, dribbble, kick, twitch, lemmy, listmonk, gmb, wrapcast, nostr, vk, quora, hackernews, instagram-standalone |
| N9 | Account-less posts | `Post.integrationId` is nullable: a post for an unconnected but extension-publishable platform is created with `providerIdentifier` and no integration. `startWorkflow` hard-fails only *no integration **and** not extension-routed* | `actions.post` silently skips every platform without a connected channel |

Minor: `getReport` sends a `section` param to `GET /task/product-latest-tasks/{id}`, which only
accepts `status` — [analysis.ts:179](../src/clients/analysis.ts#L179). Harmless (section filtering
happens in the formatter) but it implies server behaviour that does not exist.

### N8. Platform settings matrix (replaces the earlier blanket "these all 400" claim)

Verified field-by-field against each provider DTO. The earlier draft was wrong to lump these
together: several validate fine with `{}`, and listing them as failures would have produced CLI
flags nobody needs.

**Group A — `{}` is valid, no CLI flag needed.** Every field optional or the DTO is empty:
`facebook`, `kick` (`class KickDto {}`), `twitch`, `quora` (`class QuoraSettingsDto {}`), `gmb`,
plus the existing no-settings set (`threads`, `mastodon`, `bluesky`, `telegram`, `nostr`, `vk`).
→ *No work. The current `default: {}` is already correct for these.*

**Group B — already correct in the CLI.** Keep as-is:
`x`, `linkedin`, `linkedin-page`, `instagram`, `instagram-standalone`, `youtube`, `medium`.
*(Checked: `medium.subtitle: ""` is safe — `@ValidateIf(o => o.subtitle !== '')` skips it.)*

**Group C — required field the CLI can derive.** Safe default from post content:

| Platform | Required | CLI default |
|---|---|---|
| `dribbble` | `title` | first heading line (existing `extractTitle`) |
| `hackernews` | `title` (≥2) | ditto |
| `wordpress` | `title` (≥2), `type` | title + `type: "post"` |
| `devto` | `title` (≥2); `tags` defaults to `[]` | title, `tags: []` |

**Group D — required field only the user can supply.** Needs a new flag; error out with a clear
message when absent rather than sending an empty string:

| Platform | Required | Proposed flag |
|---|---|---|
| `discord`, `slack` | `channel` (channel id, ≥1) | `--channel-target <id>` |
| `pinterest` | `board` (board id, ≥1) | `--board <id>` |
| `reddit` | `subreddit` (≥2), `title` (≥2), `type` | `--subreddit <name>` (+ derived title, `type: "text"`) |
| `lemmy` | `subreddit[]` ≥1 with nested `subreddit`/`id`/`title` | `--community <name>` |
| `hashnode` | `title` (≥6), `publication` (id), `tags` ≥1 | `--publication <id> --tags <a,b>` |
| `listmonk` | `subject`, `preview`, `list` (id) | `--list <id>` (+ derived subject/preview) |

**Group E — validates but is semantically wrong.** `wrapcast` gets `{ subreddit: [] }`;
`FarcasterDto` has no `ArrayMinSize`, so it passes validation with no Farcaster channel selected.
Needs `--channel-target`, same as Group D, but it fails at publish time rather than at 400.

---

## 5. P2 — hygiene, bundled into the same pass

1. Re-sync `docs/openapi/*.json`; add the sync to the release checklist.
2. `extractApiError` + `cx` are duplicated verbatim in both clients → extract `src/clients/api-error.ts`.
3. `scanAndWait` / `scanModuleAndWait` are near-identical with a hardcoded 600s deadline / 3s poll → one helper with injectable timings.
4. **No tests exist in this repo** (no `tests/`, no `*.test.ts`) against a project rule of ≥90% coverage on core logic. Every change below lands with contract tests over mocked axios.
5. Regenerate `docs/COMMANDS.md` + `docs/SPECIFICATION.md` for each new flag.

---

## 6. Product / project identity — CLI input design

Today only `channels select` takes a product (`url` positional). `post create`, `post list` and
`post dashboard` have **no product parameter at all**, so there is no surface to carry `projectId`.
Resolving that is a prerequisite for F4, not an afterthought.

**Design.** One consistent option, added to every project-scopable command:

```
--project <url | domain | uuid>
```

- Resolution: pass the value to `GET /product/{product_id}` — the orchestrator already accepts a
  full URL, a bare domain, or a UUID — and read `id` for `projectId`. One extra request per
  invocation; no local cache in v1, add one only if it measurably hurts.
- Commands where a product is the natural subject (`channels select`, `actions`, `report`, `scan`)
  keep their existing positional `url` and treat it as `--project`; `--project` is accepted as an
  alias so scripts can be uniform.
- `post create`, `post list` and `post dashboard` gain `--project` as a **new optional flag**.
  Omitting it preserves today's org-wide behaviour (the backend's own legacy path), so this is
  additive, not breaking.
- **`post pending` gets no `--project`.** `GET /posts/publish-due/count` is
  `countDuePublishPosts(org.id)` — org-scoped, no query parameters at all. Offering the flag would
  mean either silently ignoring it or faking a project number client-side. It stays org-wide, and
  its output says so. A project-scoped backlog would need a backend change, which constraint 1
  rules out of this plan; if it is wanted later it should be raised as its own API request.
- `action-post` and the `plan` group derive it from the action/plan and never ask.

**Phase ordering.** `--project` and everything depending on it is **Phase 2 in full**. Phase 1
deliberately does not touch project scoping — F1's Phase 1 fix is the date window, `channel` and
`integrationId` only. *(The v2 draft listed project scoping inside F1's fix while scheduling it in
Phase 2; that contradiction is resolved here in favour of Phase 2.)*

---

## 7. Work plan

### Phase 1 — `0.6.2`, correctness only (no project scoping, no new commands) — IMPLEMENTED
| # | Change | Files |
|---|---|---|
| 1 | `getDashboard` → `startDate`/`endDate` window; pass `channel` + `integrationId` | `clients/post-agent.ts`, `modules/post/index.ts` |
| 2 | Drop hardcoded `content_days=0`; add `--content-days` | `clients/analysis.ts`, `modules/analysis/index.ts` |
| 3 | Poll `generated-tasks`; render `unnecessary`/`unsupported`; map 402/429/403 | `clients/analysis.ts`, `modules/analysis/index.ts` |
| 4 | Stop fabricating post `state`; surface `publishMethod`; extension-dependency notice | `clients/post-agent.ts`, `modules/post/index.ts` |
| 5 | `post create --draft`; `post publish` → `/posts/schedule` with per-item results; `--retry` → ERROR-only retry | `clients/post-agent.ts`, `modules/post/index.ts` |
| 6 | F8 + N8 Groups C/D/E: settings builders, new per-platform flags, hard error instead of empty required field | `clients/post-agent.ts`, `modules/post/index.ts` |
| 7 | Remove the dead `section` param | `clients/analysis.ts` |
| 8 | Shared `api-error.ts` with typed backend error codes | new `clients/api-error.ts` |
| 9 | Contract tests for all of the above | new `tests/` |

### Phase 2 — `0.7.0`, project scoping + extension awareness
| # | Change | Files |
|---|---|---|
| 10 | `--project <url\|domain\|uuid>` resolution helper (§6) | new `utils/project.ts` |
| 11 | Send `projectId` + `source` on `POST /posts`, `GET /posts/list`, `/dashboard/*` | `clients/*`, `modules/post/index.ts` |
| 12 | `channels select` reconciling dual-write (F5 steps 1–5) | `clients/post-agent.ts`, `modules/post/index.ts` |
| 13 | Cache `GET /posts/publish-methods`; `aisee post pending` over `publish-due/count` (**org-wide, no `--project`** — see §6) | `clients/post-agent.ts`, `modules/post/index.ts` |
| 14 | Refresh `channels add` platform enum | `modules/post/index.ts` |
| 15 | `post list` filters: `--project`, `--source`, `--channel`, `--sort`, `--plan` | `modules/post/index.ts` |
| 16 | `action-post`: create account-less posts (`providerIdentifier`, no `integration`) for extension-publishable platforms instead of skipping them | `modules/analysis/index.ts` |
| 17 | `scan --model` + `aisee models` over `/task/analyzer-models` | `clients/analysis.ts`, `modules/analysis/index.ts` |
| 18 | Re-sync OpenAPI; regenerate command docs | `docs/` |

### Phase 3 — `0.8.0`, `aisee plan` command group

Every command reports per-platform `publishMethod` so the extension dependency is visible before
the user commits credits.

**`plan create --project <url> [--from-task <task-id>] --start <iso> --end <iso> --platforms <a,b> [--keywords <a,b>] [--dry-run]`**

`POST /projects/{projectId}/operation-plans?dryRun=`. `CreateOperationPlanDto` requires **all four**
of `taskId`, `startAt`, `endAt` (both `@IsISO8601({strict:true})`) and `platforms`
(`@ArrayNotEmpty`); `keywords` is optional.

- `--from-task` **takes a value**. When omitted, resolve the project's latest completed analysis via
  the existing `GET /task/product-latest-tasks/{product_id}?status=completed` and use its `id`,
  printing which task was chosen. Error out if there is none — never send an empty `taskId`.
- **Two terminal behaviours, not one:**
  - `--dry-run` → generation runs **inline** and returns the finished preview with
    `status: "PREVIEW"`, `id: null`, `dryRun: true` and `estimatedUsage`. Nothing is persisted, so
    there is **nothing to poll**. Render the preview and exit. *(The v3 draft sent this down the
    polling path, which would have polled `GET /operation-plans/null`.)*
  - real run → returns immediately with `status: "GENERATING"` and empty content; **then** poll
    `GET /operation-plans/{id}` through `GENERATING → BILLING_PENDING → READY` or a terminal
    failure. Never present the POST response as the finished plan.

**`plan status [--project <url> | <plan-id>]`** — with no plan id, resolve via
`GET /projects/{projectId}/operation-plans/active`, which returns `{ id: null }` (not a 404) when
the project has no active plan; then `GET /operation-plans/{id}`.

**`plan posts`** — `GET /posts/list` filtered by `operationPlanId` (or `hasOperationPlan`).

**`plan activate --project <url> [--platforms <a,b>] [--publish-method extension|api]`**
→ `POST /projects/{projectId}/automation/publishing`.

`SaveAutomationPublishingDto.platforms` is **required and is the COMPLETE enabled set, not a
delta — every platform absent from it is turned off.** Sending `{ commit: true }` alone fails
validation, and sending `{ platforms: [], commit: true }` would silently disable the project's
entire publishing configuration. So:

- `--platforms` omitted → **read the current set first** via `GET /projects/{projectId}/automation`
  (which returns the publishing platforms and effective windows) and echo it back verbatim
  alongside `commit: true`. Read-modify-write, never a blind write.
- `--platforms` given → treat it as the full replacement set and **say so in the confirmation**,
  naming any platform that is about to be turned off.
- Do not send `windows` at all: a stored window survives a save that does not mention it.
- Note the server-side edge: a commit also runs when `enabled` flips OFF→ON, so `plan activate` on
  a project whose switch is already on genuinely needs `commit: true`.
- Response is `{ saved, scheduled, rescheduled }`; `scheduled` carries the same
  `scheduled`/`failed`/`total`/`alreadyScheduled` shape as `POST /posts/schedule` — render it
  per-item, same as F6.

---

## 8. Out of scope

Admin/billing (`/credit-*`, `/subscription`, `/admin/*`, `/stripe*`), Engage (`/engage/*`), GSC
(`/gsc/*`), and the extension's own reply/metrics protocols. None of the P0 findings touch them.
