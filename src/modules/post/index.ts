import { z } from "zod";
import { postAgentClient } from "../../clients/post-agent.ts";
import open from "open";
import { loadSettingsWithSource } from "../../utils/config.ts";

export const postCreateModule = {
  description: "Create and prepare a new social media post for one or more channels",
  inputSchema: z.object({
    text: z.string().optional().describe("Direct text content of the post"),
    file: z.string().optional().describe("Path to a local Markdown file to use as post content"),
    channel: z.string().describe("Channel ID or platform identifier (e.g., 'x', 'linkedin')"),
    schedule: z.string().optional().describe("Desired publication time (ISO 8601 format)"),
    image: z.string().optional().describe("Local path to an image file to attach as media")
  }),
  outputSchema: z.object({
    id: z.string().describe("Unique identifier of the created post"),
    status: z.string().describe("Initial workflow status"),
    channels: z.array(z.string()).optional().describe("Targeted channel IDs")
  }),
  async execute(input: any) {
    let content = input.text;

    if (input.file) {
      const { readFile } = await import("node:fs/promises");
      content = await readFile(input.file, "utf-8");
    }

    if (!content) {
      throw new Error("Either 'text' or 'file' must be provided.");
    }

    return await postAgentClient.createPost({
      text: content,
      channels: [input.channel],
      schedule: input.schedule,
      media: input.image ? [input.image] : []
    });
  }
};

function summarizePost(p: Record<string, unknown>): Record<string, unknown> {
  const content = String(p.content ?? p.text ?? p.message ?? "").trim();
  return {
    id: p.id,
    state: p.state ?? p.status,
    platform: (p.integration as any)?.identifier ?? p.platform ?? p.channel,
    content: content.length > 60 ? content.slice(0, 57) + "..." : content,
    scheduled: p.publishDate ?? p.scheduled_at ?? p.scheduleDate,
    created_at: p.createdAt ?? p.created_at,
  };
}

export const postListModule = {
  description: "Retrieve a list of social media posts with filtering",
  inputSchema: z.object({
    state: z.enum(["DRAFT", "QUEUE", "PUBLISHED", "ERROR"]).optional().describe("Filter posts by their current state"),
    size: z.number().int().min(1).max(100).default(10).describe("Number of items per page"),
    page: z.number().int().min(1).optional().describe("Page number (default: 1)")
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const raw = await postAgentClient.listPosts({ state: input.state, pageSize: input.size, page: input.page });

    const fmtIdx = process.argv.indexOf("--format");
    const fmt = fmtIdx !== -1 ? process.argv[fmtIdx + 1] : null;
    const effectiveFmt = fmt ?? (process.stdout.isTTY ? "table" : "json");

    if (effectiveFmt !== "table") return raw;

    const items: Record<string, unknown>[] = Array.isArray(raw?.results) ? raw.results : [];
    const pagination = {
      total: raw?.total ?? items.length,
      page: raw?.page ?? 1,
      pages: raw?.totalPages ?? 1,
    };

    const header = `total: ${pagination.total}  page: ${pagination.page}  pages: ${pagination.pages}`;
    if (items.length === 0) return `${header}\n\n(no posts)`;

    const summaries = items.map(summarizePost);
    const tables = summaries.map(s => formatKV(s)).join("\n\n");
    return `${header}\n\n${tables}`;
  }
};

function formatChannelTable(rows: Array<{ id: string; platform: string; name: string; connected: boolean }>): string {
  const cols = ["id", "platform", "name", "connected"] as const;
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c]).length)));
  const sep = widths.map(w => "-".repeat(w)).join("  ");
  const header = cols.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  const lines = rows.map(r => cols.map((c, i) => String(r[c]).padEnd(widths[i]!)).join("  "));
  return [header, sep, ...lines].join("\n");
}

export const channelListModule = {
  description: "List all connected social media channels and their status",
  inputSchema: z.object({}),
  outputSchema: z.any(),
  async execute() {
    const data = await postAgentClient.listChannels();
    const integrations: any[] = data?.integrations ?? [];
    const channels = integrations.map((ch) => ({
      id: ch.id as string,
      platform: (ch.identifier ?? ch.type ?? "") as string,
      name: (ch.display ?? ch.name ?? "") as string,
      connected: !ch.disabled && !ch.refreshNeeded,
    }));

    const fmtIdx = process.argv.indexOf("--format");
    const fmt = fmtIdx !== -1 ? process.argv[fmtIdx + 1] : null;
    const effectiveFmt = fmt ?? (process.stdout.isTTY ? "table" : "json");

    if (effectiveFmt === "table") return formatChannelTable(channels);
    return channels;
  }
};

export const channelAddModule = {
  description: "Connect a new social media account via OAuth",
  inputSchema: z.object({
    platform: z.enum([
      "x", "reddit", "linkedin", "linkedin-page", "instagram",
      "facebook", "youtube", "tiktok", "pinterest", "threads",
      "mastodon", "bluesky", "medium", "devto", "hashnode"
    ]).describe("Social platform to connect")
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

    const fmtIdx = process.argv.indexOf("--format");
    const fmt = fmtIdx !== -1 ? process.argv[fmtIdx + 1] : null;
    const effectiveFmt = fmt ?? (process.stdout.isTTY ? "table" : "json");

    if (effectiveFmt === "table") {
      return success
        ? `Channel '${data.name ?? input.id}' removed successfully.`
        : `Failed to remove channel '${input.id}'.`;
    }

    return { success };
  }
};

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

export const postDashboardModule = {
  description: "View social media engagement and traffic summary",
  inputSchema: z.object({
    period: z.enum(["24h", "7d", "30d", "90d"]).default("7d").describe("Time range for metrics"),
    channel: z.string().optional().describe("Filter metrics by platform name")
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const data = await postAgentClient.getDashboard(input.period);

    const fmtIdx = process.argv.indexOf("--format");
    const fmt = fmtIdx !== -1 ? process.argv[fmtIdx + 1] : null;
    const effectiveFmt = fmt ?? (process.stdout.isTTY ? "table" : "json");

    if (effectiveFmt !== "table") return data;

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
  description: "Publish a prepared post immediately",
  inputSchema: z.object({
    id: z.string().describe("Internal ID of the post to publish")
  }),
  outputSchema: z.object({
    status: z.string(),
    published_at: z.string().optional()
  }),
  async execute(input: any) {
    return await postAgentClient.publishPost(input.id);
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
