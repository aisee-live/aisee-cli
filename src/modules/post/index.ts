import { z } from "zod";
import { postAgentClient, VALID_CHANNELS, type MediaObject, type PlatformOptions, type PublishMethodInfo } from "../../clients/post-agent.ts";
import { analysisClient } from "../../clients/analysis.ts";
import { UserError } from "../../utils/errors.ts";
import { productUrlSchema, getDomain } from "../../utils/url.ts";
import { resolveOptionalProjectId, resolveProjectId } from "../../utils/project.ts";
import open from "open";
import { loadSettingsWithSource } from "../../utils/config.ts";

const EXTENSION_SEND_PATH_NOTE =
  "Channels with send path 'extension' publish from your signed-in Chrome via the AISee browser " +
  "extension, not from the server.";

/**
 * The backend never sends an EXTENSION-routed post itself — the user's own
 * Chrome does, via the extension's publish-due loop. A post that comes back
 * QUEUE on that path was not published, and saying nothing about it is how a
 * user ends up waiting on a post that will never go out.
 */
function extensionNotice(publishMethod: unknown): string | undefined {
  if (String(publishMethod ?? "").toUpperCase() !== "EXTENSION") return undefined;
  return (
    "Queued for the AISee browser extension — it publishes from your signed-in Chrome, " +
    "not from the server. It stays in QUEUE until that browser is running."
  );
}

function splitList(value: unknown): string[] | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value.split(",").map(v => v.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function collectPlatformOptions(input: any): PlatformOptions {
  return {
    title: input.title,
    subreddit: input.subreddit,
    board: input.board,
    channelTarget: input.channel_target,
    publication: input.publication,
    list: input.list,
    community: input.community,
    tags: splitList(input.tags),
  };
}

export const postCreateModule = {
  description: "Create and prepare a new social media post for one or more channels",
  inputSchema: z.object({
    text: z.string().optional().describe("Direct text content of the post"),
    file: z.string().optional().describe("Path to a local Markdown file to use as post content"),
    channel: z.string().describe("Channel ID"),
    project: z.string().optional().describe("Product URL, domain or ID to attribute this post to"),
    schedule: z.string().optional().describe("Desired publication time (ISO 8601 format)"),
    draft: z.boolean().default(false).describe("Create as a draft — commit it later with 'aisee post publish <id>'"),
    image: z.string().optional().describe("Local path to an image file to attach as media"),
    title: z.string().optional().describe("Title for platforms that require one (default: first line of the post)"),
    subreddit: z.string().optional().describe("reddit: target subreddit"),
    board: z.string().optional().describe("pinterest: board ID"),
    channel_target: z.string().optional().describe("discord/slack/wrapcast: target channel ID"),
    publication: z.string().optional().describe("hashnode: publication ID"),
    list: z.string().optional().describe("listmonk: mailing list ID"),
    community: z.string().optional().describe("lemmy: numeric community ID"),
    tags: z.string().optional().describe("Comma-separated tags (hashnode, devto, youtube, medium)")
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    let content = input.text;

    if (input.file) {
      const { readFile } = await import("node:fs/promises");
      content = await readFile(input.file, "utf-8");
    }

    if (!content) {
      throw new UserError("Either 'text' or 'file' must be provided.");
    }

    if (input.draft && input.schedule) {
      throw new UserError("--draft and --schedule are mutually exclusive: a draft has no publish time yet.");
    }

    let media: MediaObject[] = [];
    if (input.image) {
      media = [await postAgentClient.uploadMedia(input.image)];
    }

    const results = await postAgentClient.createPost({
      text: content,
      channels: [input.channel],
      schedule: input.schedule,
      draft: input.draft === true,
      media,
      platformOptions: collectPlatformOptions(input),
      projectId: await resolveOptionalProjectId(input.project),
    });

    const effectiveFmt = getFmt();
    const rows: Record<string, unknown>[] = Array.isArray(results) ? results : [results];
    const notices = [...new Set(rows.map(r => extensionNotice(r.publishMethod)).filter(Boolean))] as string[];
    // A draft/schedule response carries no state at all; the previous code
    // invented one, reporting "SENT" for posts that had not been sent.
    const stateOf = (r: Record<string, unknown>) =>
      r.state ?? (input.draft ? "DRAFT" : input.schedule ? "(scheduled)" : "(unknown)");

    if (effectiveFmt === "markdown") {
      const summaries = rows.map((r) => ({
        "Post ID": r.postId ?? r.id ?? "",
        State: stateOf(r),
        "Publish Method": r.publishMethod ?? "",
        URL: r.releaseURL ?? "",
      }));
      const parts = ["# Post Created", "", mdRecordTable(summaries)];
      if (notices.length > 0) parts.push("", ...notices.map(n => `> ${n}`));
      if (input.draft) parts.push("", "> Draft created. Commit it with `aisee post publish <id>`.");
      return parts.join("\n") + "\n";
    }

    if (effectiveFmt !== "table") return results;

    const blocks = rows.map(r => {
      const lines: string[] = [
        `postId   ${r.postId ?? r.id ?? ""}`,
        `state    ${stateOf(r)}`,
      ];
      if (r.publishMethod) lines.push(`sendPath ${r.publishMethod}`);
      if (r.releaseURL) lines.push(`url      ${r.releaseURL}`);
      return lines.join("\n");
    });
    if (input.draft) blocks.push("Draft created. Commit it with: aisee post publish <id>");
    blocks.push(...notices);
    return blocks.join("\n\n");
  }
};

function summarizePost(p: Record<string, unknown>, full: boolean): Record<string, unknown> {
  const content = String(p.content ?? p.text ?? p.message ?? "").trim();
  return {
    id: p.id,
    state: p.state ?? p.status,
    send_path: p.publishMethod ?? "",
    platform: (p.integration as any)?.identifier ?? p.platform ?? p.channel,
    content: full || content.length <= 60 ? content : content.slice(0, 57) + "...",
    scheduled: p.publishDate ?? p.scheduled_at ?? p.scheduleDate,
    created_at: p.createdAt ?? p.created_at,
  };
}

function escapeMdCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function mdKeyValueTable(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return "";
  const lines = ["| Field | Value |", "|-------|-------|"];
  for (const [k, v] of entries) {
    lines.push(`| ${escapeMdCell(String(k))} | ${escapeMdCell(String(v))} |`);
  }
  return lines.join("\n");
}

function mdRecordTable(records: Record<string, unknown>[]): string {
  if (records.length === 0) return "_No records._";
  const keys = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const lines = [
    "| " + keys.map((k) => escapeMdCell(k)).join(" | ") + " |",
    "| " + keys.map(() => "---").join(" | ") + " |",
  ];
  for (const r of records) {
    lines.push("| " + keys.map((k) => escapeMdCell(String(r[k] ?? ""))).join(" | ") + " |");
  }
  return lines.join("\n");
}

function getFmt(): string {
  const fmtIdx = process.argv.indexOf("--format");
  const fmt = fmtIdx !== -1 ? process.argv[fmtIdx + 1] : null;
  return fmt ?? (process.stdout.isTTY ? "table" : "json");
}

export const postListModule = {
  description: "Retrieve a list of social media posts with filtering",
  inputSchema: z.object({
    state: z.enum(["DRAFT", "QUEUE", "PUBLISHED", "ERROR"]).optional().describe("Filter posts by their current state"),
    project: z.string().optional().describe("Only posts attributed to this product (URL, domain or ID)"),
    channel: z.string().optional().describe("Comma-separated platform names (e.g. x,reddit)"),
    source: z.string().optional().describe("Comma-separated sources: calendar, chat, engage"),
    plan: z.string().optional().describe("Only posts generated by this operation plan ID"),
    sort: z.enum(["publishDate", "createdAt", "updatedAt", "state"]).optional().describe("Sort field (default: publishDate)"),
    order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default: desc)"),
    size: z.number().int().min(1).max(100).default(10).describe("Number of items per page"),
    page: z.number().int().min(1).optional().describe("Page number (default: 1)")
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const raw = await postAgentClient.listPosts({
      state: input.state,
      projectId: await resolveOptionalProjectId(input.project),
      channel: validateChannels(input.channel),
      source: splitList(input.source),
      operationPlanId: input.plan,
      sortBy: input.sort,
      sortOrder: input.order,
      pageSize: input.size,
      page: input.page,
    });

    const effectiveFmt = getFmt();
    const isVerbose = process.argv.includes("--verbose");
    const isPresentation = effectiveFmt === "table" || effectiveFmt === "markdown";

    // For machine-readable formats, --verbose returns the raw payload.
    if (!isPresentation) return raw;

    const items: Record<string, unknown>[] = Array.isArray(raw?.results) ? raw.results : [];
    const pagination = {
      total: raw?.total ?? items.length,
      page: raw?.page ?? 1,
      pages: raw?.totalPages ?? 1,
    };

    const header = `total: ${pagination.total}  page: ${pagination.page}  pages: ${pagination.pages}`;
    if (items.length === 0) {
      return effectiveFmt === "markdown"
        ? `# Posts\n\n> ${header}\n\n_No posts._\n`
        : `${header}\n\n(no posts)`;
    }

    const summaries = items.map((p) => summarizePost(p, isVerbose));

    if (effectiveFmt === "markdown") {
      const parts: string[] = [];
      parts.push("# Posts", "");
      parts.push(`> ${header}`, "");
      parts.push(mdRecordTable(summaries));
      return parts.join("\n") + "\n";
    }

    const tables = summaries.map(s => formatKV(s)).join("\n\n");
    return `${header}\n\n${tables}`;
  }
};

export const channelListModule = {
  description: "List all connected social media channels and their status",
  inputSchema: z.object({}),
  outputSchema: z.any(),
  async execute() {
    // publish-methods is org-level state the backend tells clients to fetch
    // once; a failure there must not hide the channel list itself.
    const [data, methods] = await Promise.all([
      postAgentClient.listChannels(),
      postAgentClient.getPublishMethods().catch(() => [] as PublishMethodInfo[]),
    ]);
    const sendPathByPlatform = new Map(methods.map((m) => [m.platform, m.defaultMethod]));

    const integrations: any[] = data?.integrations ?? [];
    const channels = integrations.map((ch) => {
      const platform = (ch.identifier ?? ch.type ?? "") as string;
      return {
        id: ch.id as string,
        platform,
        name: (ch.display ?? ch.name ?? "") as string,
        connected: !ch.disabled && !ch.refreshNeeded,
        send_path: sendPathByPlatform.get(platform) ?? "",
      };
    });

    const effectiveFmt = getFmt();
    const usesExtension = channels.some((c) => c.send_path === "extension");

    if (effectiveFmt === "markdown") {
      const rows = channels.map((c) => ({
        ID: c.id,
        Platform: c.platform,
        Name: c.name,
        Connected: c.connected ? "Yes" : "No",
        "Send Path": c.send_path,
      }));
      const parts = ["# Channels", "", mdRecordTable(rows)];
      if (usesExtension) parts.push("", `> ${EXTENSION_SEND_PATH_NOTE}`);
      return parts.join("\n") + "\n";
    }

    if (effectiveFmt === "table") {
      const table = formatColTable(channels as unknown as Record<string, unknown>[]);
      return usesExtension ? `${table}\n\n${EXTENSION_SEND_PATH_NOTE}` : table;
    }
    return channels;
  }
};

export const channelAddModule = {
  description: "Connect a new social media account via OAuth",
  inputSchema: z.object({
    platform: z.enum(VALID_CHANNELS).describe("Social platform to connect")
  }),
  outputSchema: z.object({
    message: z.string()
  }),
  async execute(input: any) {
    const settings = await loadSettingsWithSource()
    const url = `${settings.app_url}/post/channels/add/${input.platform}`;
    await open(url);
    return { message: `Opening browser to authorize ${input.platform} connection...` };
  }
};

export const channelRemoveModule = {
  description: "Disconnect and remove a social media channel",
  inputSchema: z.object({
    id: z.string().describe("The integration ID to remove")
  }),
  outputSchema: z.object({
    success: z.boolean()
  }),
  async execute(input: any) {
    const data = await postAgentClient.removeChannel(input.id) as Record<string, unknown>;
    const success = data?.deletedAt != null;

    const effectiveFmt = getFmt();
    const message = success
      ? `Channel '${data.name ?? input.id}' removed successfully.`
      : `Failed to remove channel '${input.id}'.`;

    if (effectiveFmt === "markdown") {
      return `# Channel Remove\n\n${message}\n`;
    }
    if (effectiveFmt === "table") return message;

    return { success };
  }
};

export const channelSelectModule = {
  description: "Bind channels to a product, or show its current channel config",
  inputSchema: z.object({
    url: productUrlSchema.describe("Product website URL"),
    channels: z.string().optional().describe(
      "Comma-separated channel IDs to bind. Omit to show the current config."
    ),
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const productId = getDomain(input.url as string);
    const effectiveFmt = getFmt();

    if (!input.channels) {
      return showChannelConfig(input.url as string, productId, effectiveFmt);
    }

    const channelIds = String(input.channels)
      .split(",")
      .map((id: string) => id.trim())
      .filter(Boolean);

    if (channelIds.length === 0) {
      throw new UserError("No channel IDs provided.");
    }

    const data = await postAgentClient.listChannels();
    const integrations: any[] = data?.integrations ?? [];

    const matched = integrations.filter((ch: any) => channelIds.includes(ch.id));
    const notFound = channelIds.filter((id: string) => !integrations.find((ch: any) => ch.id === id));

    if (notFound.length > 0) {
      throw new UserError(
        `Channel(s) not found: ${notFound.join(", ")}. Run 'aisee channels list' to see available channels.`
      );
    }

    const projectId = await resolveProjectId(input.url as string);
    const outcome = await reconcileChannelBindings(productId, projectId, matched);

    if (effectiveFmt === "markdown") {
      const rows = matched.map((ch: any) => ({
        ID: ch.id,
        Platform: ch.identifier ?? ch.type ?? "",
        Name: ch.display ?? ch.name ?? "",
      }));
      const parts = [
        "# Channels Configured", "", `Product: \`${productId}\``, "",
        mdRecordTable(rows), "",
        "## Sync", "", ...outcome.log.map((l) => `- ${l}`),
      ];
      const text = parts.join("\n") + "\n";
      if (outcome.failures.length > 0) throw new UserError(text);
      return text;
    }

    if (effectiveFmt === "table") {
      const text = [
        `Configured ${matched.length} channel(s) for '${productId}'.`,
        ...outcome.log,
      ].join("\n");
      if (outcome.failures.length > 0) throw new UserError(text);
      return text;
    }

    const result = {
      product_id: productId,
      project_id: projectId,
      channels: matched.map((ch: any) => ch.id),
      bound: outcome.bound,
      unbound: outcome.unbound,
      failures: outcome.failures,
    };
    if (outcome.failures.length > 0) {
      throw new UserError(JSON.stringify(result));
    }
    return result;
  },
};

/**
 * Bring both sides of the channel binding in line with `matched`.
 *
 * aisee-core stores the whole list on `product.config.channels` (a full
 * replace), while Postiz stores one `IntegrationProject` row per binding — and
 * the dashboard's channel counts read the Postiz side. Upserting alone would
 * leave a channel the user just removed still bound and still counted, so the
 * removals have to be deleted explicitly.
 *
 * Every step is reported. A partial failure is surfaced, never swallowed.
 */
async function reconcileChannelBindings(
  productId: string,
  projectId: string,
  matched: Array<Record<string, unknown>>,
): Promise<{ log: string[]; bound: string[]; unbound: string[]; failures: string[] }> {
  const log: string[] = [];
  const failures: string[] = [];
  const bound: string[] = [];
  const unbound: string[] = [];

  const desired = matched.map((ch) => String(ch.id));
  const desiredSet = new Set(desired);

  let current: string[] = [];
  try {
    const rows = await postAgentClient.listProjectIntegrations(projectId);
    current = rows.map((row) => String(row.id));
  } catch (error) {
    // Without the current set a safe diff is impossible: unbinding nothing
    // would silently leave stale bindings behind, so say so rather than guess.
    failures.push(`could not read existing bindings: ${(error as Error).message}`);
    log.push(`✗ postiz: could not read existing bindings — removals were NOT applied`);
  }

  for (const id of desired) {
    if (current.includes(id)) continue;
    try {
      await postAgentClient.bindIntegrationToProject(id, projectId);
      bound.push(id);
      log.push(`✓ postiz: bound ${id}`);
    } catch (error) {
      failures.push(`bind ${id}: ${(error as Error).message}`);
      log.push(`✗ postiz: failed to bind ${id} — ${(error as Error).message}`);
    }
  }

  for (const id of current) {
    if (desiredSet.has(id)) continue;
    try {
      await postAgentClient.unbindIntegrationFromProject(id, projectId);
      unbound.push(id);
      log.push(`✓ postiz: unbound ${id}`);
    } catch (error) {
      failures.push(`unbind ${id}: ${(error as Error).message}`);
      log.push(`✗ postiz: failed to unbind ${id} — ${(error as Error).message}`);
    }
  }

  try {
    await analysisClient.configChannels(productId, matched);
    log.push(`✓ aisee-core: config.channels set to ${desired.length} channel(s)`);
  } catch (error) {
    failures.push(`aisee-core: ${(error as Error).message}`);
    log.push(`✗ aisee-core: failed to write config.channels — ${(error as Error).message}`);
  }

  if (log.length === 0) log.push("Nothing to change — both sides already match.");
  return { log, bound, unbound, failures };
}

/**
 * Show the product's channel config from BOTH stores.
 *
 * They can legitimately disagree (a binding made in the web app, a core write
 * that failed halfway), and only showing one side hides that.
 */
async function showChannelConfig(url: string, productId: string, effectiveFmt: string) {
  const projectId = await resolveProjectId(url);
  const [product, projectRows] = await Promise.all([
    analysisClient.getProduct(productId),
    postAgentClient.listProjectIntegrations(projectId).catch(() => [] as Array<Record<string, unknown>>),
  ]);

  const coreChannels: any[] = product?.config?.channels ?? [];
  const boundIds = new Set(projectRows.map((row) => String(row.id)));
  const byId = new Map<string, Record<string, unknown>>();
  for (const ch of coreChannels) byId.set(String(ch.id), ch);
  for (const row of projectRows) if (!byId.has(String(row.id))) byId.set(String(row.id), row);

  const rows = [...byId.entries()].map(([id, ch]) => ({
    id,
    platform: (ch.identifier ?? ch.type ?? "") as string,
    name: (ch.display ?? ch.name ?? "") as string,
    in_core: coreChannels.some((c: any) => String(c.id) === id) ? "yes" : "no",
    in_postiz: boundIds.has(id) ? "yes" : "no",
  }));

  const drifted = rows.filter((r) => r.in_core !== r.in_postiz);
  const driftNote = drifted.length > 0
    ? `${drifted.length} channel(s) are bound on only one side. Re-run 'aisee channels select ${url} --channels <id,...>' to reconcile.`
    : "";

  if (effectiveFmt === "markdown") {
    if (rows.length === 0) {
      return `# Channel Config — ${productId}\n\n_No channels configured. Run \`aisee channels select ${url} --channels <id,...>\` to bind channels._\n`;
    }
    const parts = [
      `# Channel Config — ${productId}`, "",
      mdRecordTable(rows.map((r) => ({
        ID: r.id, Platform: r.platform, Name: r.name,
        "In aisee-core": r.in_core, "In Postiz": r.in_postiz,
      }))),
    ];
    if (driftNote) parts.push("", `> ${driftNote}`);
    return parts.join("\n") + "\n";
  }

  if (effectiveFmt === "table") {
    if (rows.length === 0) {
      return `No channels configured for '${productId}'. Run: aisee channels select ${url} --channels <id,...>`;
    }
    const table = formatColTable(rows as unknown as Record<string, unknown>[]);
    return driftNote ? `${table}\n\n${driftNote}` : table;
  }

  return rows;
}

function formatKV(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj);
  const keyWidth = Math.max(...entries.map(([k]) => k.length));
  return entries.map(([k, v]) => k.padEnd(keyWidth) + "  " + String(v ?? "")).join("\n");
}

function formatColTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "(none)";
  const keys = Object.keys(rows[0]!);
  const widths = keys.map(k => Math.max(k.length, ...rows.map(r => String(r[k] ?? "").length)));
  const sep = widths.map(w => "-".repeat(w)).join("  ");
  const header = keys.map((k, i) => k.padEnd(widths[i]!)).join("  ");
  const lines = rows.map(r => keys.map((k, i) => String(r[k] ?? "").padEnd(widths[i]!)).join("  "));
  return [header, sep, ...lines].join("\n");
}

// Whole-day windows: the backend widens startDate/endDate to startOf/endOf day
// in the request timezone, so "24h" means today, not a rolling 24 hours.
const PERIOD_DAYS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };

function periodWindow(period: string): { startDate: string; endDate: string } {
  const days = PERIOD_DAYS[period] ?? 7;
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

function validateChannels(raw: unknown): string[] | undefined {
  const list = splitList(raw);
  if (!list) return undefined;
  const invalid = list.filter(c => !(VALID_CHANNELS as readonly string[]).includes(c));
  if (invalid.length > 0) {
    throw new UserError(
      `Unknown channel(s): ${invalid.join(", ")}. Valid values: ${VALID_CHANNELS.join(", ")}`,
    );
  }
  return list;
}

export const postDashboardModule = {
  description: "View social media engagement and traffic summary",
  inputSchema: z.object({
    period: z.enum(["24h", "7d", "30d", "90d"]).default("7d").describe("Time range for metrics (whole days, in your timezone)"),
    project: z.string().optional().describe("Scope analytics to one product (URL, domain or ID)"),
    channel: z.string().optional().describe("Comma-separated platform names to filter by (e.g. x,reddit)"),
    integration: z.string().optional().describe("Comma-separated integration IDs to filter by")
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const { startDate, endDate } = periodWindow(input.period);
    const data = await postAgentClient.getDashboard({
      startDate,
      endDate,
      projectId: await resolveOptionalProjectId(input.project),
      channel: validateChannels(input.channel),
      integrationId: splitList(input.integration),
    });

    const effectiveFmt = getFmt();
    if (effectiveFmt !== "table" && effectiveFmt !== "markdown") return data;

    const stats = (data.posts_stats ?? {}) as Record<string, unknown>;
    const platforms = Array.isArray(data.channels_by_platform) ? data.channels_by_platform as Record<string, unknown>[] : [];

    const overview: Record<string, unknown> = {
      channel_count: data.channel_count,
      channel_connected_count: data.channel_connected_count,
      impressions_total: data.impressions_total,
      traffics_total: data.traffics_total,
      published_this_period: data.published_this_period,
    };
    if (data.post_send_limit != null) overview.post_send_limit = data.post_send_limit;
    if (data.period_end != null) overview.period_end = data.period_end;

    if (effectiveFmt === "markdown") {
      const parts: string[] = [];
      parts.push(`# Dashboard — ${input.period}`, "");
      parts.push("## Overview", "", mdKeyValueTable(overview), "");
      if (Object.keys(stats).length > 0) {
        parts.push("## Post Stats", "", mdKeyValueTable(stats), "");
      }
      parts.push("## Channels by Platform", "", mdRecordTable(platforms), "");
      return parts.join("\n").replace(/\n+$/, "") + "\n";
    }

    const parts: string[] = [
      "=== Overview ===",
      formatKV(overview),
      "\n=== Post Stats ===",
      formatKV(stats),
      "\n=== Channels by Platform ===",
      formatColTable(platforms),
    ];

    return parts.join("\n");
  }
};

export const postPublishModule = {
  description: "Commit a draft post to the send queue (or retry a failed one)",
  inputSchema: z.object({
    id: z.string().describe("Internal ID of the post to commit"),
    retry: z.boolean().default(false).describe("Retry a post in ERROR state instead of committing a draft"),
    publish_method: z.enum(["extension", "api"]).optional().describe("Force the send path; omit to let the backend resolve it")
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    if (input.retry) {
      // /posts/{id}/retry is ERROR-only and additionally requires a bound,
      // enabled integration — an account-less extension post can never use it.
      return await postAgentClient.retryPost(input.id);
    }

    const result = await postAgentClient.commitPosts([
      { id: input.id, ...(input.publish_method ? { publishMethod: input.publish_method } : {}) },
    ]);

    const effectiveFmt = getFmt();
    if (effectiveFmt !== "table" && effectiveFmt !== "markdown") return result;

    const lines: string[] = [];
    for (const ok of result.scheduled ?? []) {
      lines.push(`✓ ${ok.id} queued${ok.publishMethod ? ` via ${ok.publishMethod}` : ""}`);
      const notice = extensionNotice(ok.publishMethod);
      if (notice) lines.push(`  ${notice}`);
    }
    for (const bad of result.failed ?? []) {
      const hint = bad.code === "INVALID_STATE"
        ? " — only DRAFT posts can be committed; use --retry for a failed post"
        : "";
      lines.push(`✗ ${bad.id} ${bad.code}: ${bad.message}${hint}`);
    }
    if (lines.length === 0) lines.push("(no posts affected)");

    return effectiveFmt === "markdown"
      ? ["# Post Publish", "", ...lines.map(l => `- ${l}`)].join("\n") + "\n"
      : lines.join("\n");
  }
};

export const postPendingModule = {
  description: "Count posts queued for the browser extension to publish",
  // Org-wide by design: GET /posts/publish-due/count takes no parameters, so
  // there is no project-scoped variant to offer.
  inputSchema: z.object({}),
  outputSchema: z.any(),
  async execute() {
    const data = await postAgentClient.countPublishDue();
    const effectiveFmt = getFmt();
    if (effectiveFmt !== "table" && effectiveFmt !== "markdown") return data;

    const record = (data ?? {}) as Record<string, unknown>;
    const count = record.count ?? record.due ?? record.total ?? 0;
    const body = [
      `Posts waiting for the browser extension (organization-wide): ${count}`,
      Number(count) > 0
        ? "These publish from your signed-in Chrome, not from the server."
        : "",
    ].filter(Boolean);

    return effectiveFmt === "markdown"
      ? ["# Pending Extension Publishes", "", ...body].join("\n") + "\n"
      : body.join("\n");
  }
};

export const postScheduleModule = {
  description: "Update the scheduled time for a post",
  inputSchema: z.object({
    id: z.string().describe("Post ID"),
    time: z.string().describe("New target time (ISO 8601)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    scheduled_at: z.string()
  }),
  async execute(input: any) {
    return await postAgentClient.schedulePost(input.id, input.time);
  }
};
