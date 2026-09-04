import { z } from "zod";
import { analysisClient } from "../../clients/analysis.ts";
import {
  postAgentClient,
  VALID_CHANNELS,
  type OperationPlanOverview,
  type PublishMethodInfo,
} from "../../clients/post-agent.ts";
import { UserError } from "../../utils/errors.ts";
import { getOutputFormat, isPresentationFormat } from "../../utils/format.ts";
import { resolveProjectId } from "../../utils/project.ts";

function splitList(value: unknown): string[] | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value.split(",").map((v) => v.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function escapeMdCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function mdRecordTable(records: Record<string, unknown>[]): string {
  if (records.length === 0) return "_None._";
  const keys = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const lines = [
    "| " + keys.map(escapeMdCell).join(" | ") + " |",
    "| " + keys.map(() => "---").join(" | ") + " |",
  ];
  for (const r of records) {
    lines.push("| " + keys.map((k) => escapeMdCell(String(r[k] ?? ""))).join(" | ") + " |");
  }
  return lines.join("\n");
}

function formatColumnTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "(none)";
  const keys = Object.keys(rows[0]!);
  const widths = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k] ?? "").length)));
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  const header = keys.map((k, i) => k.padEnd(widths[i]!)).join("  ");
  const lines = rows.map((r) => keys.map((k, i) => String(r[k] ?? "").padEnd(widths[i]!)).join("  "));
  return [header, sep, ...lines].join("\n");
}

function formatKV(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return "(none)";
  const keyWidth = Math.max(...entries.map(([k]) => k.length));
  return entries.map(([k, v]) => k.padEnd(keyWidth) + "  " + String(v)).join("\n");
}

function validatePlatforms(raw: unknown, flag: string): string[] | undefined {
  const list = splitList(raw);
  if (!list) return undefined;
  const invalid = list.filter((p) => !(VALID_CHANNELS as readonly string[]).includes(p));
  if (invalid.length > 0) {
    throw new UserError(
      `Unknown platform(s) in ${flag}: ${invalid.join(", ")}. Valid values: ${VALID_CHANNELS.join(", ")}`,
    );
  }
  return list;
}

/** ISO 8601 is required by the DTO (`@IsISO8601({ strict: true })`). */
function toIsoInstant(value: string, flag: string): string {
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (isNaN(parsed.getTime())) {
    throw new UserError(`${flag} is not a valid date/time: '${value}'. Use ISO 8601, e.g. 2026-10-01T09:00:00Z.`);
  }
  return parsed.toISOString();
}

/**
 * Annotate each platform with the send path the backend resolves for it, so the
 * extension dependency is visible before the user spends credits on a plan.
 */
async function sendPathRows(platforms: string[]): Promise<Record<string, unknown>[]> {
  const methods: PublishMethodInfo[] = await postAgentClient.getPublishMethods().catch(() => []);
  const byPlatform = new Map(methods.map((m) => [m.platform, m]));
  return platforms.map((platform) => {
    const info = byPlatform.get(platform);
    return {
      platform,
      send_path: info?.defaultMethod ?? "",
      account: info?.hasBoundIntegration ? "connected" : "none",
      note: info?.defaultMethod === "extension"
        ? "published from your signed-in Chrome"
        : info?.defaultMethod
          ? ""
          : info?.reason ?? "no viable send path",
    };
  });
}

function planSummary(plan: OperationPlanOverview): Record<string, unknown> {
  const detail = (plan.plan ?? {}) as Record<string, unknown>;
  return {
    id: plan.id ?? detail.id ?? "",
    status: plan.status,
    starts_at: detail.startsAt ?? detail.startAt ?? "",
    ends_at: detail.endsAt ?? detail.endAt ?? "",
    posts: Array.isArray(plan.posts) ? plan.posts.length : "",
    error_code: plan.errorCode ?? "",
    error: plan.errorMessage ?? "",
  };
}

function failIfTerminalError(plan: OperationPlanOverview): void {
  if (plan.status !== "FAILED" && plan.status !== "BILLING_FAILED") return;
  const fallback = plan.status === "BILLING_FAILED"
    ? "Credit deduction was rejected for this plan."
    : "Plan generation failed.";
  throw new UserError(
    `${plan.errorMessage ?? fallback}${plan.errorCode ? ` (${plan.errorCode})` : ""} ` +
    `Neither state recovers on its own — create the plan again once the cause is fixed.`,
  );
}

export const planCreateModule = {
  description: "Generate an operation plan from a completed analysis",
  inputSchema: z.object({
    project: z.string().describe("Product URL, domain or ID"),
    from_task: z.string().optional().describe(
      "Analysis task ID to build from (default: the product's latest completed analysis)"
    ),
    start: z.string().describe("Plan start (ISO 8601, must be in the future)"),
    end: z.string().describe("Plan end (ISO 8601, after --start)"),
    platforms: z.string().describe("Comma-separated platforms to plan for"),
    keywords: z.string().optional().describe("Comma-separated Engage keywords (default: from the product snapshot)"),
    preview: z.boolean().default(false).describe("Generate a preview without billing or persisting it (--dry-run is reserved)"),
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const projectId = await resolveProjectId(input.project);
    const platforms = validatePlatforms(input.platforms, "--platforms");
    if (!platforms) throw new UserError("--platforms requires at least one platform.");

    let taskId = input.from_task as string | undefined;
    let taskNote = "";
    if (!taskId) {
      // The DTO requires a taskId; there is no server-side "latest" default.
      const latest = await analysisClient.getLatestTask(input.project, "completed");
      if (!latest?.id) {
        throw new UserError(
          `No completed analysis found for '${input.project}'. ` +
          `Run 'aisee scan ${input.project}' first, or pass --from-task <task-id>.`,
        );
      }
      taskId = String(latest.id);
      taskNote = `Using latest completed analysis: ${taskId}${latest.version_name ? ` (version ${latest.version_name})` : ""}`;
    }

    const body = {
      taskId,
      startAt: toIsoInstant(input.start, "--start"),
      endAt: toIsoInstant(input.end, "--end"),
      platforms,
      ...(splitList(input.keywords) ? { keywords: splitList(input.keywords)! } : {}),
    };

    const isTTY = process.stderr.isTTY;
    if (taskNote && isTTY) process.stderr.write(`${taskNote}\n`);

    const created = await postAgentClient.createOperationPlan(projectId, body, input.preview === true);

    // A dry run generates inline and is never persisted: status PREVIEW, id
    // null. There is nothing to poll, so this path ends here.
    if (input.preview) {
      return renderPlan(created, platforms, { preview: true, note: taskNote });
    }

    const planId = String(created.id ?? "");
    if (!planId) {
      throw new UserError("The backend did not return a plan ID; nothing to poll.");
    }

    if (isTTY) process.stderr.write(`Plan ${planId} created. Generating...\n`);
    const settled = await postAgentClient.pollOperationPlan(planId, (status) => {
      if (isTTY) process.stderr.write(`\r  status: ${status}          `);
    });
    if (isTTY) process.stderr.write("\r" + " ".repeat(40) + "\r");

    failIfTerminalError(settled);
    return renderPlan(settled, platforms, { preview: false, note: taskNote });
  },
};

async function renderPlan(
  plan: OperationPlanOverview,
  platforms: string[],
  options: { preview: boolean; note?: string },
) {
  const fmt = getOutputFormat();
  if (!isPresentationFormat(fmt)) return plan;

  const summary = planSummary(plan);
  const paths = await sendPathRows(platforms);
  const heading = options.preview ? "Operation Plan (preview — not saved)" : "Operation Plan";
  const nextStep = options.preview
    ? "Re-run without --dry-run to generate and persist this plan."
    : "Posts are DRAFT until committed — run 'aisee plan activate --project <ref>'.";

  if (fmt === "markdown") {
    const parts = [`# ${heading}`, ""];
    if (options.note) parts.push(`> ${options.note}`, "");
    parts.push(mdRecordTable([summary]), "", "## Send paths", "", mdRecordTable(paths), "", `> ${nextStep}`);
    return parts.join("\n") + "\n";
  }

  const blocks = [`=== ${heading} ===`, formatKV(summary), "\n=== Send paths ===", formatColumnTable(paths), nextStep];
  if (options.note) blocks.unshift(options.note);
  return blocks.join("\n");
}

export const planStatusModule = {
  description: "Show a project's active operation plan",
  inputSchema: z.object({
    project: z.string().describe("Product URL, domain or ID"),
    plan_id: z.string().optional().describe("Inspect a specific plan instead of the project's active one"),
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const projectId = await resolveProjectId(input.project);

    let planId = input.plan_id as string | undefined;
    if (!planId) {
      // `{ id: null }` rather than a 404: having no active plan is normal.
      planId = (await postAgentClient.getActivePlanId(projectId)) ?? undefined;
      if (!planId) {
        const message = `No active plan for '${input.project}'. Create one with 'aisee plan create --project ${input.project} ...'.`;
        const fmt = getOutputFormat();
        if (fmt === "markdown") return `# Operation Plan\n\n${message}\n`;
        if (isPresentationFormat(fmt)) return message;
        return { id: null, message };
      }
    }

    const plan = await postAgentClient.getOperationPlan(planId);
    const fmt = getOutputFormat();
    if (!isPresentationFormat(fmt)) return plan;

    const summary = planSummary(plan);
    const posts = (plan.posts ?? []).map((p: any) => ({
      id: p.id,
      state: p.state,
      platform: p.providerIdentifier ?? p.integration?.providerIdentifier ?? "",
      send_path: p.publishMethod ?? "",
      publish_date: p.publishDate ?? "",
    }));

    if (fmt === "markdown") {
      return [
        "# Operation Plan", "", mdRecordTable([summary]), "",
        "## Posts", "", mdRecordTable(posts),
      ].join("\n") + "\n";
    }
    return [`=== Plan ===`, formatKV(summary), "\n=== Posts ===", formatColumnTable(posts)].join("\n");
  },
};

export const planPostsModule = {
  description: "List posts generated by operation plans",
  inputSchema: z.object({
    project: z.string().describe("Product URL, domain or ID"),
    plan_id: z.string().optional().describe("Only posts from this plan (default: the project's active plan)"),
    all_plans: z.boolean().default(false).describe("All plan-generated posts, not just one plan's"),
    state: z.enum(["DRAFT", "QUEUE", "PUBLISHED", "ERROR"]).optional().describe("Filter by post state"),
    size: z.number().int().min(1).max(100).default(20).describe("Items per page"),
    page: z.number().int().min(1).optional().describe("Page number"),
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const projectId = await resolveProjectId(input.project);

    let planId = input.plan_id as string | undefined;
    if (!planId && !input.all_plans) {
      planId = (await postAgentClient.getActivePlanId(projectId)) ?? undefined;
      if (!planId) {
        // Falling through would list every plan's posts, which is not what was
        // asked for — say so instead of quietly widening the scope.
        const message =
          `No active plan for '${input.project}'. ` +
          `Pass --all-plans to list posts from every plan, or --plan-id <id> for a specific one.`;
        const fmt = getOutputFormat();
        if (fmt === "markdown") return `# Plan Posts\n\n${message}\n`;
        if (isPresentationFormat(fmt)) return message;
        return { results: [], total: 0, message };
      }
    }

    const raw = await postAgentClient.listPosts({
      projectId,
      state: input.state,
      pageSize: input.size,
      page: input.page,
      // The explicit plan id wins server-side; the presence filter covers the
      // "every plan-generated post" case.
      ...(planId ? { operationPlanId: planId } : { hasOperationPlan: true }),
    });

    const fmt = getOutputFormat();
    if (!isPresentationFormat(fmt)) return raw;

    const items: Record<string, unknown>[] = Array.isArray(raw?.results) ? raw.results : [];
    const header = `total: ${raw?.total ?? items.length}  page: ${raw?.page ?? 1}  pages: ${raw?.totalPages ?? 1}`;
    const rows = items.map((p: any) => ({
      id: p.id,
      state: p.state,
      platform: p.providerIdentifier ?? p.integration?.providerIdentifier ?? "",
      send_path: p.publishMethod ?? "",
      publish_date: p.publishDate ?? "",
    }));

    if (fmt === "markdown") {
      return ["# Plan Posts", "", `> ${header}`, "", mdRecordTable(rows)].join("\n") + "\n";
    }
    return `${header}\n\n${formatColumnTable(rows)}`;
  },
};

export const planActivateModule = {
  description: "Commit the project's active plan to the send queue",
  inputSchema: z.object({
    project: z.string().describe("Product URL, domain or ID"),
    platforms: z.string().optional().describe(
      "Complete set of platforms to publish to. Omit to keep the project's current set."
    ),
    publish_method: z.enum(["extension", "api"]).optional().describe("Force the send path for this batch"),
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const projectId = await resolveProjectId(input.project);
    const requested = validatePlatforms(input.platforms, "--platforms");

    let platforms = requested;
    let disabled: string[] = [];

    // `platforms` is required AND is the complete enabled set — a platform left
    // out is switched off, and an empty array switches everything off. So when
    // the user does not name a set, read the current one and echo it back
    // rather than writing a blind value.
    const automation = await postAgentClient.getAutomation(projectId);
    const configured = automation.publishing?.platforms ?? {};
    const currentlyEnabled = Object.entries(configured)
      .filter(([, value]) => value?.enabled === true)
      .map(([platform]) => platform);

    if (!platforms) {
      if (currentlyEnabled.length === 0) {
        throw new UserError(
          `No platforms are enabled for '${input.project}', and an empty set would switch scheduled ` +
          `publishing off entirely. Pass --platforms <a,b> to choose them.`,
        );
      }
      platforms = currentlyEnabled;
    } else {
      disabled = currentlyEnabled.filter((p) => !platforms!.includes(p));
    }

    const result = await postAgentClient.saveAutomationPublishing(projectId, {
      platforms,
      commit: true,
      ...(input.publish_method ? { publishMethod: input.publish_method } : {}),
    });

    const scheduled = result.scheduled?.scheduled ?? [];
    const failed = result.scheduled?.failed ?? [];

    const fmt = getOutputFormat();
    if (!isPresentationFormat(fmt)) {
      return { projectId, platforms, disabled, ...result };
    }

    const lines: string[] = [`Platforms enabled: ${platforms.join(", ")}`];
    if (disabled.length > 0) {
      lines.push(`Platforms switched OFF by this call: ${disabled.join(", ")}`);
    }
    if (result.scheduled === null || result.scheduled === undefined) {
      lines.push("No posts were committed (the project had nothing in DRAFT).");
    }
    for (const ok of scheduled) {
      lines.push(`✓ ${ok.id} queued${ok.publishMethod ? ` via ${ok.publishMethod}` : ""}`);
    }
    for (const bad of failed) {
      lines.push(`✗ ${bad.id} ${bad.code}: ${bad.message}`);
    }
    if (scheduled.some((p) => p.publishMethod === "extension")) {
      lines.push(
        "Posts queued via 'extension' publish from your signed-in Chrome, not from the server.",
      );
    }

    const text = fmt === "markdown"
      ? ["# Plan Activated", "", ...lines.map((l) => `- ${l}`)].join("\n") + "\n"
      : lines.join("\n");

    if (failed.length > 0) throw new UserError(text);
    return text;
  },
};
