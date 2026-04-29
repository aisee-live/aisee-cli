import { z } from "zod";
import { analysisClient, type TaskTreeNode } from "../../clients/analysis.ts";
import { loadCredentials } from "../../utils/config.ts";
import { productUrlSchema } from "../../utils/url.ts";
import { UserError } from "../../utils/errors.ts";

function notFoundError(url: string): UserError {
  const hint = url.startsWith("http://")
    ? ` If the site was scanned using 'https://', try: aisee report https://${url.slice(7)}`
    : ` Run 'aisee scan ${url}' to start a new analysis.`;
  return new UserError(`No report found for '${url}'.${hint}`);
}

const ANALYZER_DISPLAY_NAMES: Record<string, string> = {
  code_web_fit_analyzer: "web_fit_score",
  code_ai_competitor_analyzer: "competitor_score",
  code_ai_presence_analyzer: "ai_presence_score",
};

// Maps CLI section names to keys inside result object
const SECTION_TO_ANALYZER_KEY: Record<string, string> = {
  presence: "code_ai_presence_analyzer",
  competitor: "code_ai_competitor_analyzer",
  strategy: "code_web_fit_analyzer",
};


function formatTimestamp(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+[+-]\d{2}:\d{2}$/, " UTC").replace(/\+00:00$/, " UTC");
}

function formatKeyValueTable(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null);
  const keyWidth = Math.max(...entries.map(([k]) => k.length));
  const valWidth = Math.max(20, ...entries.map(([, v]) => String(v).length));
  const sep = "-".repeat(keyWidth) + "  " + "-".repeat(Math.min(valWidth, 60));
  const header = "Key".padEnd(keyWidth) + "  Value";
  const rows = entries.map(([k, v]) => k.padEnd(keyWidth) + "  " + String(v ?? ""));
  return [header, sep, ...rows].join("\n");
}

function extractSectionDisplay(sectionResult: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (typeof sectionResult.total_score === "number") {
    out.total_score = (sectionResult.total_score as number).toFixed(2);
  }
  if (sectionResult.grade) out.grade = String(sectionResult.grade);

  const breakdown = sectionResult.score_breakdown as Record<string, number> | undefined;
  if (breakdown && typeof breakdown === "object") {
    for (const [k, v] of Object.entries(breakdown)) {
      out[k] = typeof v === "number" ? v.toFixed(2) : String(v ?? "");
    }
  }

  const summary = sectionResult.summary;
  if (Array.isArray(summary) && summary.length > 0) {
    out.summary = String(summary[0]);
  } else if (typeof summary === "string" && summary) {
    out.summary = summary;
  }

  if (typeof sectionResult.actions === "number") {
    out.actions = sectionResult.actions;
  }

  return out;
}

function summarizeReport(record: Record<string, unknown>, section = "summary"): Record<string, unknown> {
  const resultObj = record.result as Record<string, unknown> | undefined;

  const meta: Record<string, unknown> = {
    id: record.id,
    status: record.status,
    version: record.version_name,
    url: record.url,
    created_at: typeof record.created_at === "string" ? formatTimestamp(record.created_at) : record.created_at,
  };
  if (record.name) meta.name = record.name;

  if (section === "summary") {
    const agg = (resultObj?.result ?? resultObj) as Record<string, unknown> | undefined;
    const childrenScores = (agg?.children_scores ?? {}) as Record<string, number>;
    const subScores: Record<string, string> = {};
    for (const [code, score] of Object.entries(childrenScores)) {
      const key = ANALYZER_DISPLAY_NAMES[code] ?? code;
      subScores[key] = typeof score === "number" ? score.toFixed(2) : String(score);
    }
    return {
      ...meta,
      total_score: typeof agg?.total_score === "number" ? (agg.total_score as number).toFixed(2) : "-",
      ...subScores,
    };
  }

  const analyzerKey = SECTION_TO_ANALYZER_KEY[section];
  const analyzerData = (analyzerKey ? resultObj?.[analyzerKey] : resultObj) as Record<string, unknown> | undefined;
  const sectionResult = (analyzerData?.result ?? analyzerData) as Record<string, unknown> | undefined;

  if (!sectionResult) {
    return { ...meta, section, note: `Section '${section}' data not available` };
  }

  return { ...meta, section, ...extractSectionDisplay(sectionResult) };
}

function summarizeHistoryRecord(record: Record<string, unknown>): Record<string, unknown> {
  const resultObj = record.result as Record<string, unknown> | undefined;
  const childrenScores = (resultObj?.children_scores ?? {}) as Record<string, number>;

  const subScores: Record<string, string> = {};
  for (const [code, score] of Object.entries(childrenScores)) {
    const key = ANALYZER_DISPLAY_NAMES[code] ?? code;
    subScores[key] = typeof score === "number" ? score.toFixed(2) : String(score);
  }

  const totalScore = record.score ?? resultObj?.total_score;

  return {
    id: record.id,
    code: record.code,
    status: record.status,
    total_score: typeof totalScore === "number" ? totalScore.toFixed(2) : (totalScore ?? "-"),
    ...subScores,
    url: record.url,
    created_at: typeof record.created_at === "string" ? formatTimestamp(record.created_at) : record.created_at,
  };
}

export const scanModule = {
  description: "Start AEO analysis for a product with complete task orchestration",
  inputSchema: z.object({
    url: productUrlSchema.describe("Website URL to scan"),
    module: z.string().optional().describe("Specify a module to scan"),
    streaming: z.boolean().default(false).describe("Enable streaming HTTP response from the analysis API"),
    use_demo: z.boolean().default(false).describe("Use demo mode for testing (no credits consumed)"),
    wait: z.boolean().default(true).describe("Wait for scan results (use --no-wait to return immediately after submitting)")
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const baseParams = { stream: input.streaming, use_demo: input.use_demo };
    if (input.wait === false) {
      let data: any;
      if (input.module) {
        const analyzerKey = SECTION_TO_ANALYZER_KEY[input.module] ?? input.module;
        data = await analysisClient.scanModule(input.url, analyzerKey, baseParams);
      } else {
        data = await analysisClient.scan(input.url, baseParams);
      }
      if (process.stderr.isTTY) {
        process.stderr.write(`Scan submitted. Run 'aisee report ${input.url}' to check results.\n`);
      }
      if (data && typeof data === "object") {
        const d = data as Record<string, unknown>;
        const taskTree = d.task_tree as { task?: Record<string, unknown> } | undefined;
        const versionName = taskTree?.task?.version_name;
        const flat = Object.fromEntries(
          Object.entries(d).filter(([, v]) => v === null || typeof v !== "object")
        );
        if (versionName !== undefined) flat.version = versionName;
        return flat;
      }
      return data;
    }

    const isTTY = process.stderr.isTTY;
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let prevLineCount = 0;

    function statusIcon(status: string, frame: number): string {
      if (status === "completed") return "✓";
      if (status === "failed") return "✗";
      if (status === "ignored") return "-";
      if (status === "in_progress" || status === "processing") return frames[frame % frames.length];
      return "○";
    }

    function renderNode(node: TaskTreeNode, depth: number, frame: number): string[] {
      const indent = "  ".repeat(depth);
      const icon = statusIcon(node.task.status, frame);
      const lines = [`${indent}${icon} ${node.task.name}`];
      for (const child of node.children ?? []) {
        lines.push(...renderNode(child, depth + 1, frame));
      }
      return lines;
    }

    if (isTTY) process.stderr.write("Analyzing...\n");
    const onTree = isTTY ? (tree: TaskTreeNode, frame: number) => {
      if (frame === 0) {
        const version = tree.task.version_name ? `Version ${tree.task.version_name}` : "";
        process.stderr.write(`\x1b[1A\x1b[2K\rScan started ${version}\nPress Ctrl+C to stop monitoring — scan continues in background.\n\n`);
        prevLineCount = 0;
      }
      if (prevLineCount > 0) {
        process.stderr.write(`\x1b[${prevLineCount}A\x1b[J`);
      }
      const version = tree.task.version_name ? `  [${tree.task.version_name}]` : "";
      const lines = renderNode(tree, 0, frame);
      if (lines.length > 0) lines[0] += version;
      prevLineCount = lines.length;
      process.stderr.write(lines.join("\n") + "\n");
    } : undefined

    let result: any;
    if (input.module) {
      const analyzerKey = SECTION_TO_ANALYZER_KEY[input.module] ?? input.module;
      result = await analysisClient.scanModuleAndWait(
        input.url,
        analyzerKey,
        { stream: input.streaming, use_demo: input.use_demo },
        onTree
      );
    } else {
      result = await analysisClient.scanAndWait(
        input.url,
        { stream: input.streaming, use_demo: input.use_demo },
        onTree
      );
    }

    if (isTTY && prevLineCount > 0) {
      process.stderr.write(`\x1b[${prevLineCount}A\x1b[J`);
    }

    if (getEffectiveFormat() !== "table") return result;
    return formatScanResult(result as Record<string, unknown>);
  }
};

function formatScanResult(raw: Record<string, unknown>): string {
  const root = (raw?.result ?? raw) as Record<string, unknown>;
  const parts: string[] = [];

  // scores
  const scores: Record<string, unknown> = {};
  if (typeof root.total_score === "number") scores.total_score = root.total_score.toFixed(2);
  const children = root.children_scores as Record<string, number> | undefined;
  if (children) {
    for (const [k, v] of Object.entries(children)) {
      scores[k.replace(/^code_/, "").replace(/_analyzer$/, "")] = (v as number).toFixed(2);
    }
  }
  if (Object.keys(scores).length > 0) parts.push(formatKeyValueTable(scores));

  // score breakdown
  const breakdown = root.score_breakdown as Record<string, number> | undefined;
  if (breakdown) {
    const bd: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(breakdown)) bd[k] = (v as number).toFixed(2);
    parts.push("\n--- score breakdown ---\n" + formatKeyValueTable(bd));
  }

  // summary (deduplicated)
  const summary = root.summary as string[] | string | undefined;
  if (summary) {
    const lines = (Array.isArray(summary) ? summary : [summary]);
    const unique = [...new Set(lines)];
    parts.push("\n--- summary ---\n" + unique.join("\n"));
  }

  // recommendations (deduplicated, first 5)
  const recs = root.recommendations as string[] | undefined;
  if (Array.isArray(recs) && recs.length > 0) {
    const unique = [...new Set(recs)].slice(0, 5);
    parts.push("\n--- recommendations ---\n" + unique.map((r, i) => `${i + 1}. ${r}`).join("\n"));
  }

  return parts.join("\n");
}

export const reportModule = {
  description: "Retrieve aggregated analysis reports for a product",
  inputSchema: z.object({
    url: productUrlSchema.describe("Website URL associated with the product"),
    section: z.enum(["summary", "presence", "competitor", "strategy"])
      .optional().default("summary").describe("Report section: summary | presence | competitor | strategy"),
    ver: z.string().optional().describe("Fetch a specific historical version (e.g. 7.0)"),
    history: z.boolean().optional().describe("List all available historical versions for this URL"),
    page: z.number().int().min(1).optional().describe("Page number for history listing (default: 1)"),
    size: z.number().int().min(1).max(100).optional().describe("Number of items per page for history listing (default: 10)")
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const creds = await loadCredentials();
    const isVerbose = process.argv.includes("--verbose");

    if (input.history !== undefined) {
      const raw = await analysisClient.getPostList({
        product_id: input.url,
        user_id: creds?.userId,
        status: "completed",
        page: input.page,
        size: input.size
      }).catch((err: unknown) => {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 404) throw notFoundError(input.url);
        throw err;
      });

      if (isVerbose) return raw;

      const page = raw as { items?: Record<string, unknown>[]; total?: number; page?: number; size?: number; pages?: number };
      const records: Record<string, unknown>[] = Array.isArray(raw)
        ? raw as Record<string, unknown>[]
        : Array.isArray(page?.items)
          ? page.items
          : [raw as Record<string, unknown>];

      const summaries = records.map(summarizeHistoryRecord);

      const fmtIdx = process.argv.indexOf("--format");
      const fmt = fmtIdx !== -1 ? process.argv[fmtIdx + 1] : null;
      const effectiveFmt = fmt ?? (process.stdout.isTTY ? "table" : "json");

      if (effectiveFmt === "csv") return summaries;

      const pagination = {
        total: page.total ?? summaries.length,
        page: page.page ?? 1,
        pages: page.pages ?? 1,
      };

      if (effectiveFmt === "table") {
        const header = `total: ${pagination.total}  page: ${pagination.page}  pages: ${pagination.pages}`;
        const tables = summaries.map(s => formatKeyValueTable(s)).join("\n\n");
        return `${header}\n\n${tables}`;
      }

      return { ...pagination, items: summaries };
    }

    const section = input.section ?? "summary";

    const raw = await analysisClient.getReport(input.url, {
      version: input.ver,
      user_id: creds?.userId
    }).catch((err: unknown) => {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 404) throw notFoundError(input.url);
      throw err;
    });

    if (isVerbose) return raw;

    if (raw && typeof raw === "object" && "result" in (raw as object)) {
      return summarizeReport(raw as Record<string, unknown>, section);
    }
    return raw;
  }
};

function summarizeAction(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: item.id,
    sn: item.sn,
    module: item.source_module,
    category: item.analysis_cat,
    title: item.title,
    difficulty: item.difficulty,
    impact: item.impact_rating,
    current_score: item.current_score,
    expected_score: item.expected_score,
    status: item.status,
  };
  if (item.description) out.description = String(item.description).slice(0, 80);

  const solutions = item.solution_data;
  if (Array.isArray(solutions) && solutions.length > 0) {
    out.solution = (solutions as TaskItem[])
      .map(s => `[${(s.type ?? "?").toUpperCase()}] ${String(s.title ?? "").slice(0, 60)}`)
      .join("\n" + " ".repeat(16));
  }

  return out;
}

export const actionsListModule = {
  description: "List actionable optimization tasks",
  inputSchema: z.object({
    url: productUrlSchema.describe("Website URL"),
    module: z.string().optional().describe("Filter by source module (ai_presence, competitor, strategy)"),
    page: z.number().int().min(1).default(1),
    size: z.number().int().min(1).max(1000).default(10),
    sort_by: z.string().default("position"),
    sort_order: z.enum(["asc", "desc"]).default("asc"),
    status: z.string().optional().describe("Filter by status (pending, in_progress, completed...)")
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const raw = await analysisClient.getActions(input.url, input);

    if (process.argv.includes("--verbose")) return raw;

    const page = raw as { items?: Record<string, unknown>[]; total?: number; page?: number; pages?: number };
    const items: Record<string, unknown>[] = Array.isArray(page?.items) ? page.items : [];
    const summaries = items.map(summarizeAction);

    const fmtIdx = process.argv.indexOf("--format");
    const fmt = fmtIdx !== -1 ? process.argv[fmtIdx + 1] : null;
    const effectiveFmt = fmt ?? (process.stdout.isTTY ? "table" : "json");

    if (effectiveFmt === "csv") return summaries;

    const pagination = {
      total: page.total ?? summaries.length,
      page: page.page ?? 1,
      pages: page.pages ?? 1,
    };

    if (effectiveFmt === "table") {
      const header = `total: ${pagination.total}  page: ${pagination.page}  pages: ${pagination.pages}`;
      const tables = summaries.map(s => formatKeyValueTable(s)).join("\n\n");
      return `${header}\n\n${tables}`;
    }

    return { ...pagination, items: summaries };
  }
};

function getEffectiveFormat(): string {
  const fmtIdx = process.argv.indexOf("--format");
  const fmt = fmtIdx !== -1 ? process.argv[fmtIdx + 1] : null;
  return fmt ?? (process.stdout.isTTY ? "table" : "json");
}

type TaskItem = {
  type?: string;
  platform?: string;
  title?: string;
  content?: string;
  code?: string;
  steps?: unknown[];
  [k: string]: unknown;
};

function formatSuggestTask(task: TaskItem, index: number, total: number): string {
  const lines: string[] = [];
  const typeLabel = task.type === "TECHNICAL" ? "TECHNICAL" : "CONTENT";
  lines.push(`[${index + 1}/${total}] [${typeLabel}] ${task.title ?? "(no title)"}`);

  if (task.type === "CONTENT") {
    if (task.platform) lines.push(`Platform: ${task.platform}`);
    if (task.content) lines.push("", task.content.trim());
  } else {
    // TECHNICAL and any future types
    if (task.content) lines.push("", task.content.trim());
    if (task.code) lines.push("", task.code.trim());
    if (Array.isArray(task.steps) && task.steps.length > 0) {
      lines.push("", "Steps:");
      task.steps.forEach((step, i) => lines.push(`  ${i + 1}. ${String(step)}`));
    }
  }

  return lines.join("\n");
}

function formatTaskResult(data: Record<string, unknown>): string {
  const parts: string[] = [];

  const tasks = data.tasks;
  const taskList: TaskItem[] = Array.isArray(tasks) ? tasks : [];

  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === "tasks") continue;
    if (v !== null && v !== undefined && typeof v !== "object") meta[k] = v;
  }
  if (Object.keys(meta).length > 0) {
    parts.push(formatKeyValueTable(meta));
  }

  if (taskList.length > 0) {
    parts.push("");
    for (let i = 0; i < taskList.length; i++) {
      parts.push(formatSuggestTask(taskList[i], i, taskList.length));
      if (i < taskList.length - 1) parts.push("\n" + "─".repeat(60));
    }
  }

  return parts.join("\n");
}

export const actionsSuggestModule = {
  description: "Get detailed AI implementation suggestions",
  inputSchema: z.object({
    actionId: z.string().describe("Action task ID"),
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const data = await analysisClient.getSuggestion(input.actionId);
    if (getEffectiveFormat() === "table") {
      return formatTaskResult(data as Record<string, unknown>);
    }
    return data;
  }
};

export const actionsPostModule = {
  description: "Convert a task implementation plan into a social media post draft",
  inputSchema: z.object({
    actionId: z.string().describe("Action ID to convert"),
    channel: z.string().optional()
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const data = await analysisClient.convertToPost(input.actionId, input.channel);
    if (getEffectiveFormat() === "table") {
      return formatTaskResult(data as Record<string, unknown>);
    }
    return data;
  }
};
