import { z } from "zod";
import { analysisClient, type TaskTreeNode } from "../../clients/analysis.ts";
import { postAgentClient } from "../../clients/post-agent.ts";
import { loadCredentials } from "../../utils/config.ts";
import { productUrlSchema, normalizeProductUrl } from "../../utils/url.ts";
import { UserError } from "../../utils/errors.ts";
import { isDebug } from "../../utils/log-level.ts";

function dbg(msg: string, data?: unknown): void {
  if (!isDebug()) return;
  const payload = data !== undefined ? ` ${JSON.stringify(data, null, 2)}` : "";
  process.stderr.write(`[debug] ${msg}${payload}\n`);
}

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

// Maps internal AI model identifiers to user-facing platform/vendor names.
// Used for AI Presence and Competitor Landscape per-model breakdowns.
const MODEL_PLATFORM_NAMES: Record<string, string> = {
  "claude-sonnet-4-6": "Anthropic",
  "gemini-3.1-pro-preview": "Google",
  "gpt-5.2": "OpenAI",
  "grok-4": "X-AI",
  "sonar": "Perplexity",
};

function modelPlatformName(modelKey: string): string {
  return MODEL_PLATFORM_NAMES[modelKey] ?? modelKey;
}

// Maps strategy / web_fit breakdown keys to user-facing labels.
const STRATEGY_LABELS: Record<string, string> = {
  content_answerability: "Answerability",
  web_presence: "Web Presence",
  structured_data: "Structured Data",
  ai_crawler_accessibility: "AI Crawler Accessibility",
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

function mdBulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function mdNumberedList(items: string[]): string {
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
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

function platformBreakdown(analyzerData: Record<string, unknown> | undefined, prefix: string): Record<string, number> {
  if (!analyzerData) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(analyzerData)) {
    if (!key.startsWith(prefix)) continue;
    const modelKey = key.slice(prefix.length);
    const score = (value as Record<string, unknown> | undefined)?.result as Record<string, unknown> | undefined;
    const totalScore = score?.total_score;
    if (typeof totalScore === "number") {
      out[modelPlatformName(modelKey)] = totalScore;
    }
  }
  return out;
}

function formatScoreNumber(value: unknown): string {
  if (typeof value !== "number" || Number.isNaN(value)) return String(value ?? "");
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// --- verbose-mode helpers ---------------------------------------------------
// These mirror the field paths used by the web app's full-report components
// (see aisee-app/.../full-report/_components/{ai-presence,competitor-landscape,strategy-review}.tsx
// and analysisAdapter.ts). Keep them in sync when the analyzer payload changes.

function boolGlyph(score: unknown): string {
  return Number(score) > 0 ? "[pass]" : "[fail]";
}

function scoreGlyph(score: unknown): string {
  const n = Number(score);
  if (!Number.isFinite(n)) return "";
  if (n === 100) return "[pass]";
  if (n === 0) return "[fail]";
  return "[warn]";
}

interface AIPresenceModelRow {
  Platform: string;
  Model: string;
  Name: string;
  Industry: string;
  Citation: string;
  Coverage: string;
  Uncertainty: string;
  Score: string;
}

function collectAIPresenceModels(analyzerData: Record<string, unknown> | undefined): AIPresenceModelRow[] {
  if (!analyzerData) return [];
  const rows: AIPresenceModelRow[] = [];
  for (const [key, value] of Object.entries(analyzerData)) {
    if (!key.startsWith("code_ai_presence_analyzer_")) continue;
    const v = value as Record<string, unknown> | undefined;
    const fullModel = String(v?.__model ?? "");
    const [platform, model] = fullModel.includes("/") ? fullModel.split("/") : ["", fullModel];
    const result = v?.result as Record<string, unknown> | undefined;
    const brand = (v?.brand as Record<string, unknown> | undefined)?.score;
    const industry = (v?.industry as Record<string, unknown> | undefined)?.score;
    const citation = (v?.citation as Record<string, unknown> | undefined)?.score;
    const coverageRatio = (v?.coverage as Record<string, unknown> | undefined)?.coverage_ratio;
    const uncertainty = (v?.uncertainty as Record<string, unknown> | undefined)?.score;
    const allBoolFalse = !(Number(brand) > 0) && !(Number(industry) > 0) && !(Number(citation) > 0) && !(Number(coverageRatio) > 0);
    const uncertaintyPresent = allBoolFalse ? true : Number(uncertainty) < 0;
    rows.push({
      Platform: modelPlatformName(platform || model),
      Model: model || "(unknown)",
      Name: boolGlyph(brand),
      Industry: boolGlyph(industry),
      Citation: boolGlyph(citation),
      Coverage: typeof coverageRatio === "number" ? `${(coverageRatio * 100).toFixed(0)}%` : "-",
      Uncertainty: uncertaintyPresent ? "Present" : "None",
      Score: typeof result?.total_score === "number" ? formatScoreNumber(result.total_score) : "-",
    });
  }
  rows.sort((a, b) => a.Platform.localeCompare(b.Platform) || a.Model.localeCompare(b.Model));
  return rows;
}

interface CompetitorModelRow {
  platform: string;
  model: string;
  appearance: string;
  score: string;
  competitors: string[];
}

function collectCompetitorModels(analyzerData: Record<string, unknown> | undefined): CompetitorModelRow[] {
  if (!analyzerData) return [];
  const rows: CompetitorModelRow[] = [];
  for (const [key, value] of Object.entries(analyzerData)) {
    if (!key.startsWith("code_ai_competitor_analyzer_")) continue;
    const v = value as Record<string, unknown> | undefined;
    const fullModel = String(v?.__model ?? "");
    const [platform, model] = fullModel.includes("/") ? fullModel.split("/") : ["", fullModel];
    const result = v?.result as Record<string, unknown> | undefined;
    const presence = v?.presence as Record<string, unknown> | undefined;
    const competitors = Array.isArray(presence?.competitors)
      ? (presence!.competitors as unknown[]).map(String).filter((c) => c !== "<UNKNOWN>")
      : [];
    const ratio = presence?.presence_ratio;
    rows.push({
      platform: modelPlatformName(platform || model),
      model: model || "(unknown)",
      appearance: typeof ratio === "number" ? `${(ratio * 100).toFixed(0)}%` : "-",
      score: typeof result?.total_score === "number" ? formatScoreNumber(result.total_score) : "-",
      competitors,
    });
  }
  rows.sort((a, b) => a.platform.localeCompare(b.platform) || a.model.localeCompare(b.model));
  return rows;
}

function renderCompetitorList(competitors: string[]): string {
  if (competitors.length === 0) return "_no recommendations_";
  const medals = ["#1", "#2", "#3"];
  return competitors
    .map((c, i) => (i < medals.length ? `${medals[i]} ${c}` : c))
    .join(", ");
}

function buildAIPresenceVerbose(analyzerData: Record<string, unknown> | undefined): string {
  const rows = collectAIPresenceModels(analyzerData);
  if (rows.length === 0) return "";
  const parts: string[] = [];
  parts.push("### AI Presence — Per-Model Detail", "");
  parts.push(mdRecordTable(rows as unknown as Record<string, unknown>[]), "");
  return parts.join("\n");
}

function buildCompetitorVerbose(analyzerData: Record<string, unknown> | undefined): string {
  const rows = collectCompetitorModels(analyzerData);
  if (rows.length === 0) return "";
  const parts: string[] = [];
  parts.push("### Competitor Landscape — Per-Model Detail", "");
  // Group by platform vendor so the rendering matches the tabbed UI.
  const byPlatform = new Map<string, CompetitorModelRow[]>();
  for (const row of rows) {
    const list = byPlatform.get(row.platform) ?? [];
    list.push(row);
    byPlatform.set(row.platform, list);
  }
  for (const [platform, group] of byPlatform) {
    parts.push(`#### ${platform}`, "");
    for (const row of group) {
      parts.push(`- **${row.model}** — appearance ${row.appearance}, score ${row.score}`);
      parts.push(`  - Recommended: ${renderCompetitorList(row.competitors)}`);
    }
    parts.push("");
  }
  return parts.join("\n");
}

function fmtTagWithGlyph(label: string, score: unknown, suffix?: string): string {
  const glyph = scoreGlyph(score);
  const num = Number(score);
  const numText = Number.isFinite(num) && num !== 0 && num !== 100 ? ` ${num}` : "";
  return `${label}${numText}${glyph ? ` ${glyph}` : ""}${suffix ? ` (${suffix})` : ""}`;
}

function buildContentAnswerabilityVerbose(tags: Record<string, unknown> | undefined, score: number | null): string {
  if (!tags || Object.keys(tags).length === 0) return "";
  const parts: string[] = [];
  parts.push(`#### Content Answerability${score !== null ? ` — ${formatScoreNumber(score)}` : ""}`, "");
  // Schema Markup
  const schemaScores = [tags.schema_types_score, tags.organization_schema_score, tags.product_schema_score, tags.faq_schema_score];
  const configured = schemaScores.filter((s) => Number(s) === 100).length;
  parts.push(`**Schema Markup** — ${configured}/4 configured`);
  parts.push(`- Schema Types ${scoreGlyph(tags.schema_types_score)}`);
  parts.push(`- Organization ${scoreGlyph(tags.organization_schema_score)}`);
  parts.push(`- Product ${scoreGlyph(tags.product_schema_score)}`);
  parts.push(`- FAQ ${scoreGlyph(tags.faq_schema_score)}`, "");
  // Content Quality
  parts.push("**Content Quality**");
  parts.push(`- ${fmtTagWithGlyph("Conversational Tone", tags.conversational_tone_score)}`);
  parts.push(`- ${fmtTagWithGlyph("Statistics Usage", tags.statistics_usage_score)}`);
  const citationsFound = tags.citations_found;
  parts.push(`- ${fmtTagWithGlyph("Citations Count", tags.citations_count_score, citationsFound !== undefined ? `#${citationsFound} citations` : undefined)}`);
  const avgPara = tags.average_paragraph_length;
  const depthSuffix = typeof avgPara === "number" ? `Average ${avgPara.toFixed(1)} sentences per paragraph` : undefined;
  parts.push(`- ${fmtTagWithGlyph("Content Depth", tags.content_depth_score, depthSuffix)}`, "");
  return parts.join("\n");
}

const WEB_PRESENCE_PLATFORMS = ["reddit", "twitter", "github", "linkedin", "wikipedia"] as const;
const WEB_PRESENCE_FIELDS: Record<string, string[]> = {
  reddit: ["verified", "reddit_comments", "reddit_posts", "reddit_activity"],
  twitter: ["verified"],
  github: ["verified", "github_presence"],
  linkedin: ["verified", "linkedin_company"],
  wikipedia: ["verified", "wikipedia_page_exists", "wikipedia_page_length", "wikipedia_references_count", "wikipedia_last_updated"],
};
const WEB_PRESENCE_LABELS: Record<string, string> = {
  verified: "Verified",
  reddit_comments: "Comments",
  reddit_posts: "Posts",
  reddit_activity: "Activity",
  github_presence: "Presence",
  linkedin_company: "Linked",
  wikipedia_page_exists: "Page Exists",
  wikipedia_page_length: "Length",
  wikipedia_references_count: "References",
  wikipedia_last_updated: "Recent Updates",
};

function buildWebPresenceVerbose(tags: Record<string, unknown> | undefined, score: number | null): string {
  if (!tags || Object.keys(tags).length === 0) return "";
  const parts: string[] = [];
  parts.push(`#### Web Presence${score !== null ? ` — ${formatScoreNumber(score)}` : ""}`, "");
  for (const platformKey of WEB_PRESENCE_PLATFORMS) {
    const scores = (tags[`${platformKey}_scores`] as Record<string, unknown> | undefined) ?? {};
    const fields = WEB_PRESENCE_FIELDS[platformKey];
    const fieldGlyphs = fields.map((field) => {
      const label = WEB_PRESENCE_LABELS[field] ?? field;
      let val: unknown;
      if (field === "verified") {
        val = scores.verified === true ? 100 : 0;
      } else {
        val = scores[`${field}_score`] ?? scores[field];
      }
      const num = Number(val);
      const glyph = scoreGlyph(num);
      const numText = Number.isFinite(num) && num !== 0 && num !== 100 ? ` ${num}` : "";
      return `${label}${numText} ${glyph}`.trim();
    });
    const overall = scores.score;
    const overallText = typeof overall === "number" ? `score ${overall.toFixed(0)}` : "score -";
    const platformLabel = platformKey === "twitter" ? "X" : platformKey.charAt(0).toUpperCase() + platformKey.slice(1);
    parts.push(`- **${platformLabel}** — ${fieldGlyphs.join(", ")}; ${overallText}`);
  }
  parts.push("");
  return parts.join("\n");
}

function buildStructuredDataVerbose(tags: Record<string, unknown> | undefined, score: number | null): string {
  if (!tags || Object.keys(tags).length === 0) return "";
  const parts: string[] = [];
  parts.push(`#### Structured Data${score !== null ? ` — ${formatScoreNumber(score)}` : ""}`, "");
  const schemaTypes = Array.isArray(tags.schema_types_detected) ? tags.schema_types_detected as string[] : [];
  parts.push(`**Detected schema types**: ${schemaTypes.length > 0 ? schemaTypes.join(", ") : "_none_"}`, "");
  const semanticTags = Array.isArray(tags.semantic_tags_used) ? tags.semantic_tags_used as string[] : [];
  parts.push(`**Semantic Tags**: ${semanticTags.length > 0 ? semanticTags.join(", ") : "_none_"}`);
  const heading = tags.heading_structure as Record<string, unknown> | undefined;
  if (heading && Object.keys(heading).length > 0) {
    const fmt: Record<string, string> = { h1_count: "H1 count", total_headings: "Total", structure: "Proper hierarchy" };
    const items = Object.entries(heading)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${fmt[k] ?? k.replace(/_/g, " ")}${k === "structure" ? "" : ` ${v}`}`);
    parts.push(`**Heading Hierarchy**: ${items.join(", ")}`);
  }
  const altCoverage = tags.alt_text_coverage;
  if (typeof altCoverage === "number") {
    parts.push(`**Alt Texts**: ${altCoverage.toFixed(2)}% ${scoreGlyph(altCoverage)}`);
  }
  parts.push("");
  return parts.join("\n");
}

const CRAWLER_BASIC = ["sitemap_exists", "robots_txt", "links_txt", "canonical_urls", "llms_txt"];
const CRAWLER_MULTILANG = ["languages_detected", "english_version", "hreflang_tags"];
const CRAWLER_PERF = ["pre_rendered", "page_speed", "mobile_friendly"];
const CRAWLER_LABELS: Record<string, string> = {
  sitemap_exists: "Sitemap",
  robots_txt: "Robots.txt",
  links_txt: "Links.txt",
  canonical_urls: "Canonical",
  llms_txt: "Llms.txt",
  languages_detected: "Languages Detected",
  english_version: "English",
  hreflang_tags: "Hreflang Tags",
  pre_rendered: "Pre-Rendered",
  page_speed: "Page Speed",
  mobile_friendly: "Mobile Friendly",
};

function fmtCrawlerTag(tags: Record<string, unknown>, key: string): string {
  const label = CRAWLER_LABELS[key] ?? key;
  const score = tags[`${key}_score`];
  // Special: languages_detected shows the detected count alongside the glyph.
  if (key === "languages_detected") {
    const count = tags.languages_detected ?? tags.languages_count;
    const glyph = scoreGlyph(score);
    return `${count !== undefined ? `${count} ` : ""}Languages Detected ${glyph}`.trim();
  }
  return `${label} ${scoreGlyph(score)}`.trim();
}

function buildCrawlerAccessibilityVerbose(tags: Record<string, unknown> | undefined, score: number | null): string {
  if (!tags || Object.keys(tags).length === 0) return "";
  const parts: string[] = [];
  parts.push(`#### AI Crawler Accessibility${score !== null ? ` — ${formatScoreNumber(score)}` : ""}`, "");
  parts.push(`**Basic Configuration**: ${CRAWLER_BASIC.map((k) => fmtCrawlerTag(tags, k)).join(", ")}`);
  parts.push(`**Multi-language Support**: ${CRAWLER_MULTILANG.map((k) => fmtCrawlerTag(tags, k)).join(", ")}`);
  parts.push(`**Performance & Rendering**: ${CRAWLER_PERF.map((k) => fmtCrawlerTag(tags, k)).join(", ")}`, "");
  return parts.join("\n");
}

function buildStrategyVerbose(strategyAnalyzer: Record<string, unknown> | undefined): string {
  if (!strategyAnalyzer) return "";
  const breakdown = (strategyAnalyzer.result as Record<string, unknown> | undefined)?.score_breakdown as Record<string, number> | undefined;
  const parts: string[] = [];
  parts.push("### Strategy Review — Detailed Breakdown", "");
  parts.push(buildContentAnswerabilityVerbose(
    strategyAnalyzer.content_answerability as Record<string, unknown> | undefined,
    typeof breakdown?.content_answerability === "number" ? breakdown.content_answerability : null,
  ));
  parts.push(buildWebPresenceVerbose(
    strategyAnalyzer.web_presence as Record<string, unknown> | undefined,
    typeof breakdown?.web_presence === "number" ? breakdown.web_presence : null,
  ));
  parts.push(buildStructuredDataVerbose(
    strategyAnalyzer.structured_data as Record<string, unknown> | undefined,
    typeof breakdown?.structured_data === "number" ? breakdown.structured_data : null,
  ));
  parts.push(buildCrawlerAccessibilityVerbose(
    strategyAnalyzer.ai_crawler_accessibility as Record<string, unknown> | undefined,
    typeof breakdown?.ai_crawler_accessibility === "number" ? breakdown.ai_crawler_accessibility : null,
  ));
  return parts.filter((p) => p !== "").join("\n");
}

function buildReportMarkdown(record: Record<string, unknown>, section: string, verbose = false): string {
  const resultObj = record.result as Record<string, unknown> | undefined;
  const url = String(record.url ?? "");
  const sectionLabel = section === "summary" ? "Summary" : section.charAt(0).toUpperCase() + section.slice(1);

  const parts: string[] = [];

  if (section === "summary") {
    const agg = (resultObj?.result ?? resultObj) as Record<string, unknown> | undefined;
    const webAnalyzer = resultObj?.code_web_analyzer as Record<string, unknown> | undefined;
    const productSnapshot = record.product_snapshot as Record<string, unknown> | undefined;

    const brandName = (webAnalyzer?.brand_name as string | undefined) ?? (productSnapshot?.name as string | undefined) ?? url;
    parts.push(`# AEO Report — ${brandName}`, "");

    // Score
    const totalScore = typeof agg?.total_score === "number" ? (agg.total_score as number) : null;

    // About / Overview
    const description =
      (webAnalyzer?.company_description as string | undefined) ||
      (productSnapshot?.long_description as string | undefined) ||
      (productSnapshot?.short_description as string | undefined) ||
      (productSnapshot?.description as string | undefined) ||
      "";

    parts.push("## Score", "");
    if (totalScore !== null) {
      parts.push(`**${totalScore.toFixed(1)}** / 100`, "");
    } else {
      parts.push("_Score not available._", "");
    }

    parts.push(`## About ${brandName}`, "");
    if (description) parts.push(description, "");

    const aboutMeta: Record<string, unknown> = {
      URL: record.url,
      Created: typeof record.created_at === "string" ? formatTimestamp(record.created_at) : record.created_at,
      Version: record.version_name,
      Industry: webAnalyzer?.industry_primary ?? productSnapshot?.industry,
      "Secondary Industry": webAnalyzer?.industry_secondary,
      "Business Type": webAnalyzer?.business_type,
      "Primary Market": webAnalyzer?.primary_market ?? productSnapshot?.primary_market,
      Status: record.status,
    };
    parts.push(mdKeyValueTable(aboutMeta), "");

    // AI Presence — per-platform breakdown
    const aiPresenceData = resultObj?.code_ai_presence_analyzer as Record<string, unknown> | undefined;
    const aiPresenceResult = aiPresenceData?.result as Record<string, unknown> | undefined;
    const aiPresenceTotal = typeof aiPresenceResult?.total_score === "number" ? aiPresenceResult.total_score as number : null;
    const platformScores = platformBreakdown(aiPresenceData, "code_ai_presence_analyzer_");

    parts.push(`## AI Presence${aiPresenceTotal !== null ? ` — ${aiPresenceTotal.toFixed(1)}` : ""}`, "");
    parts.push("Tests how well major AI platforms recognize and understand your brand.", "");
    if (Object.keys(platformScores).length > 0) {
      const rows = Object.entries(platformScores)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([platform, score]) => ({ Platform: platform, Score: formatScoreNumber(score) }));
      parts.push(mdRecordTable(rows), "");
    }

    // Competitor Landscape
    const competitorData = resultObj?.code_ai_competitor_analyzer as Record<string, unknown> | undefined;
    const competitorResult = competitorData?.result as Record<string, unknown> | undefined;
    const competitorTotal = typeof competitorResult?.total_score === "number" ? competitorResult.total_score as number : null;

    parts.push(`## Competitor Landscape${competitorTotal !== null ? ` — ${competitorTotal.toFixed(1)}` : ""}`, "");
    parts.push("Tracks which competitors appear with your brand in AI queries and evaluates competitive visibility.", "");
    const competitorBreakdown = competitorResult?.score_breakdown as Record<string, number> | undefined;
    if (competitorBreakdown && Object.keys(competitorBreakdown).length > 0) {
      const bd: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(competitorBreakdown)) {
        const label = k.charAt(0).toUpperCase() + k.slice(1);
        bd[label] = formatScoreNumber(v);
      }
      parts.push(mdKeyValueTable(bd), "");
    }
    const competitorPlatforms = platformBreakdown(competitorData, "code_ai_competitor_analyzer_");
    if (Object.keys(competitorPlatforms).length > 0) {
      parts.push("**Per-platform scores:**", "");
      const rows = Object.entries(competitorPlatforms)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([platform, score]) => ({ Platform: platform, Score: formatScoreNumber(score) }));
      parts.push(mdRecordTable(rows), "");
    }

    // Strategy Review (web_fit)
    const strategyData = resultObj?.code_web_fit_analyzer as Record<string, unknown> | undefined;
    const strategyResult = strategyData?.result as Record<string, unknown> | undefined;
    const strategyTotal = typeof strategyResult?.total_score === "number" ? strategyResult.total_score as number : null;

    parts.push(`## Strategy Review${strategyTotal !== null ? ` — ${strategyTotal.toFixed(1)}` : ""}`, "");
    parts.push("Comprehensive assessment of website AI-friendliness across content, structure, and accessibility.", "");
    const strategyBreakdown = strategyResult?.score_breakdown as Record<string, number> | undefined;
    if (strategyBreakdown && Object.keys(strategyBreakdown).length > 0) {
      const bd: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(strategyBreakdown)) {
        bd[STRATEGY_LABELS[k] ?? k] = formatScoreNumber(v);
      }
      parts.push(mdKeyValueTable(bd), "");
    }

    // Top-level summary lines & recommendations from aggregate
    const summary = agg?.summary as string[] | string | undefined;
    if (summary) {
      const summLines = (Array.isArray(summary) ? summary : [summary]).filter(Boolean);
      const unique = [...new Set(summLines)];
      if (unique.length > 0) {
        parts.push("## Summary", "", mdBulletList(unique), "");
      }
    }

    const recs = agg?.recommendations as string[] | undefined;
    if (Array.isArray(recs) && recs.length > 0) {
      const unique = [...new Set(recs)];
      parts.push("## Recommendations", "", mdNumberedList(unique), "");
    }

    // Verbose mode: append per-model details and full strategy breakdown
    // mirroring the three full-report tabs in the web app.
    if (verbose) {
      parts.push("## Detailed Breakdown", "");
      const aiPresenceBlock = buildAIPresenceVerbose(aiPresenceData);
      if (aiPresenceBlock) parts.push(aiPresenceBlock);
      const competitorBlock = buildCompetitorVerbose(competitorData);
      if (competitorBlock) parts.push(competitorBlock);
      const strategyBlock = buildStrategyVerbose(strategyData);
      if (strategyBlock) parts.push(strategyBlock);
    }

    return parts.join("\n").replace(/\n+$/, "") + "\n";
  }

  // Section detail view
  const meta: Record<string, unknown> = {
    URL: record.url,
    Status: record.status,
    Version: record.version_name,
    Created: typeof record.created_at === "string" ? formatTimestamp(record.created_at) : record.created_at,
  };
  if (record.name) meta.Name = record.name;
  if (record.id) meta.ID = record.id;

  parts.push(`# AEO Report — ${url} — ${sectionLabel}`, "");
  parts.push("## Overview", "", mdKeyValueTable(meta), "");

  const analyzerKey = SECTION_TO_ANALYZER_KEY[section];
  const analyzerData = (analyzerKey ? resultObj?.[analyzerKey] : resultObj) as Record<string, unknown> | undefined;
  const sectionResult = (analyzerData?.result ?? analyzerData) as Record<string, unknown> | undefined;

  if (!sectionResult) {
    parts.push(`> Section \`${section}\` data not available`, "");
    return parts.join("\n").replace(/\n+$/, "") + "\n";
  }

  const score: Record<string, unknown> = {};
  if (typeof sectionResult.total_score === "number") {
    score["Total Score"] = (sectionResult.total_score as number).toFixed(2);
  }
  if (sectionResult.grade) score["Grade"] = String(sectionResult.grade);
  if (typeof sectionResult.actions === "number") score["Actions"] = sectionResult.actions;
  if (Object.keys(score).length > 0) {
    parts.push("## Score", "", mdKeyValueTable(score), "");
  }

  const breakdown = sectionResult.score_breakdown as Record<string, number> | undefined;
  if (breakdown && Object.keys(breakdown).length > 0) {
    const bd: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(breakdown)) {
      bd[k] = typeof v === "number" ? (v as number).toFixed(2) : String(v ?? "");
    }
    parts.push("## Score Breakdown", "", mdKeyValueTable(bd), "");
  }

  const summary = sectionResult.summary as string[] | string | undefined;
  if (summary) {
    const summLines = (Array.isArray(summary) ? summary : [summary]).filter(Boolean);
    const unique = [...new Set(summLines)];
    if (unique.length > 0) {
      parts.push("## Summary", "", mdBulletList(unique), "");
    }
  }

  const recs = sectionResult.recommendations as string[] | undefined;
  if (Array.isArray(recs) && recs.length > 0) {
    const unique = [...new Set(recs)];
    parts.push("## Recommendations", "", mdNumberedList(unique), "");
  }

  const findings = sectionResult.findings as unknown[] | undefined;
  if (Array.isArray(findings) && findings.length > 0) {
    const allObjects = findings.every((f) => f !== null && typeof f === "object" && !Array.isArray(f));
    parts.push("## Findings", "");
    if (allObjects) {
      parts.push(mdRecordTable(findings as Record<string, unknown>[]));
    } else {
      parts.push(mdBulletList(findings.map((f) => String(f))));
    }
    parts.push("");
  }

  return parts.join("\n").replace(/\n+$/, "") + "\n";
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
    input.url = normalizeProductUrl(input.url);
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

        const fmt = getEffectiveFormat();
        if (fmt === "markdown") {
          return ["# Scan Submitted", "", mdKeyValueTable(flat)].join("\n") + "\n";
        }
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

    const fmt = getEffectiveFormat();
    if (fmt === "markdown") return formatScanResultMarkdown(result as Record<string, unknown>, input.url);
    if (fmt !== "table") return result;
    return formatScanResult(result as Record<string, unknown>);
  }
};

function formatScanResultMarkdown(raw: Record<string, unknown>, url: string): string {
  const root = (raw?.result ?? raw) as Record<string, unknown>;
  const parts: string[] = [];
  parts.push(`# Scan Result — ${url}`, "");

  const scores: Record<string, unknown> = {};
  if (typeof root.total_score === "number") scores["Total"] = (root.total_score as number).toFixed(2);
  const children = root.children_scores as Record<string, number> | undefined;
  if (children) {
    for (const [k, v] of Object.entries(children)) {
      const key = k.replace(/^code_/, "").replace(/_analyzer$/, "");
      scores[key] = typeof v === "number" ? v.toFixed(2) : String(v);
    }
  }
  if (Object.keys(scores).length > 0) {
    parts.push("## Scores", "", mdKeyValueTable(scores), "");
  }

  const breakdown = root.score_breakdown as Record<string, number> | undefined;
  if (breakdown && Object.keys(breakdown).length > 0) {
    const bd: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(breakdown)) {
      bd[k] = typeof v === "number" ? (v as number).toFixed(2) : String(v ?? "");
    }
    parts.push("## Score Breakdown", "", mdKeyValueTable(bd), "");
  }

  const summary = root.summary as string[] | string | undefined;
  if (summary) {
    const lines = (Array.isArray(summary) ? summary : [summary]).filter(Boolean);
    const unique = [...new Set(lines)];
    if (unique.length > 0) parts.push("## Summary", "", mdBulletList(unique), "");
  }

  const recs = root.recommendations as string[] | undefined;
  if (Array.isArray(recs) && recs.length > 0) {
    const unique = [...new Set(recs)];
    parts.push("## Recommendations", "", mdNumberedList(unique), "");
  }

  return parts.join("\n").replace(/\n+$/, "") + "\n";
}

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
    input.url = normalizeProductUrl(input.url);
    const creds = await loadCredentials();
    const isVerbose = process.argv.includes("--verbose");

    if (input.history === true) {
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

      const effectiveFmt = getEffectiveFormat();
      // --verbose returns raw data only for machine-readable formats; markdown/table
      // are presentation formats and should always go through the formatter.
      if (isVerbose && !isPresentationFormat(effectiveFmt)) return raw;

      const page = raw as { items?: Record<string, unknown>[]; total?: number; page?: number; size?: number; pages?: number };
      const records: Record<string, unknown>[] = Array.isArray(raw)
        ? raw as Record<string, unknown>[]
        : Array.isArray(page?.items)
          ? page.items
          : [raw as Record<string, unknown>];

      const summaries = records.map(summarizeHistoryRecord);

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

      if (effectiveFmt === "markdown") {
        const parts: string[] = [];
        parts.push(`# Report History — ${input.url}`, "");
        parts.push(`> total: ${pagination.total} · page: ${pagination.page} · pages: ${pagination.pages}`, "");
        parts.push(mdRecordTable(summaries));
        return parts.join("\n") + "\n";
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

    const effectiveFmt = getEffectiveFormat();
    if (isVerbose && !isPresentationFormat(effectiveFmt)) return raw;

    if (effectiveFmt === "markdown" && raw && typeof raw === "object" && "result" in (raw as object)) {
      return buildReportMarkdown(raw as Record<string, unknown>, section, isVerbose);
    }

    if (effectiveFmt === "table" && raw && typeof raw === "object" && "result" in (raw as object)) {
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
    status: z.string().optional().describe("Filter by status (pending, in_progress, completed...)"),
    has_solution: z.boolean().optional().describe("Filter by has solution")
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    input.url = normalizeProductUrl(input.url);
    const raw = await analysisClient.getActions(input.url, input);

    const effectiveFmt = getEffectiveFormat();
    if (process.argv.includes("--verbose") && !isPresentationFormat(effectiveFmt)) return raw;

    const page = raw as { items?: Record<string, unknown>[]; total?: number; page?: number; pages?: number };
    const items: Record<string, unknown>[] = Array.isArray(page?.items) ? page.items : [];
    const summaries = items.map(summarizeAction);

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

    if (effectiveFmt === "markdown") {
      return buildActionsMarkdown(items, input.url as string, pagination);
    }

    return { ...pagination, items: summaries };
  }
};

function buildActionsMarkdown(
  items: Record<string, unknown>[],
  url: string,
  pagination: { total: number; page: number; pages: number },
): string {
  const parts: string[] = [];
  parts.push(`# Actions — ${url}`, "");
  parts.push(`> total: ${pagination.total} · page: ${pagination.page} · pages: ${pagination.pages}`, "");

  if (items.length === 0) {
    parts.push("_No actions._");
    return parts.join("\n") + "\n";
  }

  items.forEach((item, idx) => {
    const title = String(item.title ?? "(no title)");
    parts.push(`## ${idx + 1}. ${title}`, "");

    const meta: Record<string, unknown> = {
      ID: item.id,
      SN: item.sn,
      Module: item.source_module,
      Category: item.analysis_cat,
      Difficulty: item.difficulty,
      Impact: item.impact_rating,
      "Current Score": item.current_score,
      "Expected Score": item.expected_score,
      Status: item.status,
    };
    parts.push(mdKeyValueTable(meta), "");

    if (item.description) {
      parts.push("**Description**", "", String(item.description).trim(), "");
    }

    const solutions = item.solution_data;
    if (Array.isArray(solutions) && solutions.length > 0) {
      parts.push("**Solutions**", "");
      const tasks = solutions as TaskItem[];
      const allScalar = tasks.every((s) => !s.content && !s.code && !(Array.isArray(s.steps) && s.steps.length > 0));
      if (allScalar) {
        for (const s of tasks) {
          const type = (s.type ?? "?").toUpperCase();
          const platform = s.platform ? ` · ${s.platform}` : "";
          parts.push(`- **[${type}${platform}]** ${String(s.title ?? "")}`);
        }
        parts.push("");
      } else {
        tasks.forEach((s, i) => {
          const type = (s.type ?? "?").toUpperCase();
          const platform = s.platform ? ` · ${s.platform}` : "";
          parts.push(`### ${idx + 1}.${i + 1} [${type}${platform}] ${s.title ?? ""}`, "");
          if (s.content) parts.push(s.content.trim(), "");
          if (s.code) parts.push("```", s.code.trim(), "```", "");
          if (Array.isArray(s.steps) && s.steps.length > 0) {
            parts.push("**Steps:**", "");
            s.steps.forEach((step, n) => parts.push(`${n + 1}. ${String(step)}`));
            parts.push("");
          }
        });
      }
    }
  });

  return parts.join("\n").replace(/\n+$/, "") + "\n";
}

function getEffectiveFormat(): string {
  const fmtIdx = process.argv.indexOf("--format");
  const fmt = fmtIdx !== -1 ? process.argv[fmtIdx + 1] : null;
  return fmt ?? (process.stdout.isTTY ? "table" : "json");
}

// Presentation formats render summarized/styled output. With these formats,
// `--verbose` should NOT short-circuit to raw data — the user explicitly asked
// for a rendered view.
function isPresentationFormat(fmt: string): boolean {
  return fmt === "table" || fmt === "markdown";
}

type TaskItem = {
  type?: string;
  platform?: string;
  title?: string;
  content?: string;
  code?: string;
  steps?: unknown[];
  sn?: number;
  post_id?: string;
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

function formatTaskResultMarkdown(data: Record<string, unknown>): string {
  const parts: string[] = [];
  parts.push("# Action Suggestions", "");

  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === "tasks") continue;
    if (v !== null && v !== undefined && typeof v !== "object") meta[k] = v;
  }
  if (Object.keys(meta).length > 0) {
    parts.push("## Overview", "", mdKeyValueTable(meta), "");
  }

  const tasks = data.tasks;
  const taskList: TaskItem[] = Array.isArray(tasks) ? tasks : [];
  if (taskList.length === 0) {
    return parts.join("\n").replace(/\n+$/, "") + "\n";
  }

  parts.push("## Tasks", "");
  taskList.forEach((task, i) => {
    const typeLabel = task.type === "TECHNICAL" ? "TECHNICAL" : "CONTENT";
    parts.push(`### ${i + 1}. [${typeLabel}] ${task.title ?? "(no title)"}`, "");
    if (task.type === "CONTENT") {
      if (task.platform) parts.push(`- **Platform**: ${task.platform}`);
      if (task.content) parts.push("", task.content.trim(), "");
    } else {
      if (task.content) parts.push(task.content.trim(), "");
      if (task.code) parts.push("```", task.code.trim(), "```", "");
      if (Array.isArray(task.steps) && task.steps.length > 0) {
        parts.push("**Steps:**", "");
        task.steps.forEach((step, idx) => parts.push(`${idx + 1}. ${String(step)}`));
        parts.push("");
      }
    }
  });

  return parts.join("\n").replace(/\n+$/, "") + "\n";
}

export const actionsSuggestModule = {
  description: "Get detailed AI implementation suggestions",
  inputSchema: z.object({
    action_id: z.string().describe("Action task ID"),
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const data = await analysisClient.getSuggestion(input.action_id);
    const fmt = getEffectiveFormat();
    if (fmt === "markdown") {
      return formatTaskResultMarkdown(data as Record<string, unknown>);
    }
    if (fmt === "table") {
      return formatTaskResult(data as Record<string, unknown>);
    }
    return data;
  }
};

export const actionsPostModule = {
  description: "Create social media posts from action solution data",
  inputSchema: z.object({
    action_id: z.string().describe("Action ID to post"),
    channel_id: z.string().optional().describe("Only post to this channel ID. Default: all matching channels in product config"),
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const action = await analysisClient.getAction(input.action_id);
    if (!action) {
      throw new UserError(`Action ${input.action_id} not found`);
    }

    const productId = action.product_id || action.task_id;
    if (!productId) {
      throw new UserError(`Product ID not found for action ${input.action_id}`);
    }

    dbg("product_id", productId);

    const product = await analysisClient.getProduct(productId);
    const configChannels: any[] = product?.config?.channels || [];

    dbg("product.config.channels", configChannels.map((c: any) => ({
      id: c.id, identifier: c.identifier, name: c.name, disable: c.disable, deletedAt: c.deletedAt
    })));

    if (configChannels.length === 0) {
      throw new UserError("No channels configured for this product. Run 'aisee channels add' to connect.");
    }

    const activeChannels = input.channel_id
      ? configChannels.filter((c: any) => c.id === input.channel_id)
      : configChannels.filter((c: any) => !c.disable && !c?.deletedAt);

    if (activeChannels.length === 0) {
      throw new UserError(
        input.channel_id
          ? `Channel '${input.channel_id}' not found in product config.`
          : "No active channels in product config."
      );
    }

    const tasks = (action.solution_data || []) as TaskItem[];
    const contentTasks = tasks.filter(t => t.type === "CONTENT" && !t?.post_id);

    dbg("solution_data content tasks", contentTasks.map(t => ({
      sn: t.sn, platform: t.platform, post_id: t.post_id, title: String(t.title ?? "").slice(0, 60)
    })));

    if (contentTasks.length === 0) {
      throw new UserError("No unposted CONTENT tasks found in this action.");
    }

    const postResults = [];
    const skippedPlatforms = new Set<string>();

    for (const task of contentTasks) {
      let platform = task.platform;
      if (!platform) continue;
      if (platform == 'twitter') platform = 'x';

      const matchingChannels = activeChannels.filter((c: any) => c.identifier === platform);

      if (matchingChannels.length === 0) {
        skippedPlatforms.add(platform);
        continue;
      }

      for (const channel of matchingChannels) {
        const result = await postAgentClient.createPost({
          text: task.content || task.title || "",
          channels: [channel.id],
        });
        const postId = result[0]?.postId;
        if (postId != null && task.sn != null) {
          try {
            await analysisClient.updateActionPost(action.id, task.sn, postId);
          } catch (error) {
            process.stderr.write(`[warn] Failed to record post_id for sn=${task.sn}: ${error}\n`);
          }
        }
        postResults.push({
          task: task.title,
          platform: platform,
          channel: channel.name,
          result: result
        });
      }
    }

    if (skippedPlatforms.size > 0) {
      process.stderr.write(
        `[skip] No connected channel for: ${[...skippedPlatforms].join(", ")}. Run 'aisee channels add' to connect.\n`
      );
    }

    if (postResults.length === 0) {
      throw new UserError("No tasks were posted. Connect a matching channel and try again.");
    }

    const effectiveFmt = getEffectiveFormat();

    if (effectiveFmt === "markdown") {
      const parts: string[] = [];
      parts.push("# Posted Tasks", "");
      const rows = postResults.map((r) => {
        const res = Array.isArray(r.result) ? r.result[0] : r.result;
        return {
          Task: r.task,
          Platform: r.platform,
          Channel: r.channel,
          "Post ID": (res as Record<string, unknown> | undefined)?.postId ?? (res as Record<string, unknown> | undefined)?.id ?? "",
          Status: (res as Record<string, unknown> | undefined)?.state ?? (res as Record<string, unknown> | undefined)?.status ?? "",
        };
      });
      parts.push(mdRecordTable(rows));
      return parts.join("\n") + "\n";
    }

    if (effectiveFmt !== "table") return postResults;

    return postResults.map(r => {
      const lines = [
        `Task:     ${r.task}`,
        `Platform: ${r.platform}`,
        `Channel:  ${r.channel}`,
      ];
      const res = Array.isArray(r.result) ? r.result[0] : r.result;
      if (res?.postId || res?.id) lines.push(`Post ID:  ${res.postId || res.id}`);
      if (res?.state || res?.status) lines.push(`Status:   ${res.state || res.status}`);
      return lines.join("\n");
    }).join("\n\n");
  }
};
