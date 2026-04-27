import { z } from "zod";
import { analysisClient } from "../../clients/analysis.ts";
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
    id: typeof record.id === "string" ? record.id.slice(0, 8) : record.id,
    status: record.status,
    version: record.version_name,
    url: record.url,
    created_at: typeof record.created_at === "string" ? formatTimestamp(record.created_at) : record.created_at,
  };
  if (record.name) meta.name = record.name;

  if (section === "summary") {
    const agg = resultObj?.result as Record<string, unknown> | undefined;
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
    id: typeof record.id === "string" ? record.id.slice(0, 8) : record.id,
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
    task_template_id: z.string().optional().describe("Specify a custom task template ID"),
    streaming: z.boolean().default(false).describe("Enable streaming HTTP response from the analysis API"),
    use_demo: z.boolean().default(false).describe("Use demo mode for testing (no credits consumed)")
  }),
  outputSchema: z.object({
    task_id: z.string(),
    product_id: z.string(),
    status: z.string(),
    created_at: z.string()
  }),
  async execute(input: any) {
    return await analysisClient.scan(input.url, {
      task_template_id: input.task_template_id,
      stream: input.streaming,
      use_demo: input.use_demo
    });
  }
};

export const reportModule = {
  description: "Retrieve aggregated analysis reports for a product",
  inputSchema: z.object({
    url: productUrlSchema.describe("Website URL associated with the product"),
    section: z.enum(["summary", "presence", "competitor", "strategy"])
      .optional().default("summary").describe("Report section: summary | presence | competitor | strategy"),
    version: z.string().optional().describe("Fetch a specific historical version (e.g. v2.0)"),
    history: z.boolean().optional().describe("List all available historical versions for this URL")
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const creds = await loadCredentials();

    if (input.history !== undefined) {
      const raw = await analysisClient.getPostList({
        product_id: input.url,
        user_id: creds?.userId,
        status: "completed"
      }).catch((err: unknown) => {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 404) throw notFoundError(input.url);
        throw err;
      });

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
      version: input.version,
      user_id: creds?.userId
    }).catch((err: unknown) => {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 404) throw notFoundError(input.url);
      throw err;
    });

    if (raw && typeof raw === "object" && "result" in (raw as object)) {
      return summarizeReport(raw as Record<string, unknown>, section);
    }
    return raw;
  }
};

export const actionsListModule = {
  description: "List actionable optimization tasks",
  inputSchema: z.object({
    url: productUrlSchema.describe("Website URL"),
    page: z.number().int().min(1).default(1),
    size: z.number().int().min(1).max(1000).default(10),
    sort_by: z.string().default("position"),
    sort_order: z.enum(["asc", "desc"]).default("asc"),
    status: z.string().optional().describe("Filter by status (pending, in_progress, completed...)")
  }),
  outputSchema: z.object({
    items: z.array(z.any()),
    total: z.number(),
    page: z.number(),
    size: z.number(),
    pages: z.number()
  }),
  async execute(input: any) {
    return await analysisClient.getActions(input.url, input);
  }
};

export const actionsSuggestModule = {
  description: "Get detailed AI implementation suggestions",
  inputSchema: z.object({
    actionId: z.string().describe("Action ID to generate tasks for"),
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    return await analysisClient.getSuggestion(input.actionId);
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
    return await analysisClient.convertToPost(input.actionId, input.channel);
  }
};
