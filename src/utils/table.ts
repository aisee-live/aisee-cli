/**
 * Shared table and Markdown rendering helpers.
 *
 * These were copied into every command module as it was written — up to four
 * identical copies of the same eight lines — which is how two of them ended up
 * under different names (`formatColTable` / `formatColumnTable`) and one with a
 * different empty-state string.
 */

/** Make a value safe to place inside a Markdown table cell. */
export function escapeMdCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** One Markdown row per record, with a column per key seen across all of them. */
export function mdRecordTable(records: Record<string, unknown>[]): string {
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

/** A two-column Markdown table of an object's non-empty entries. */
export function mdKeyValueTable(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return "";
  const lines = ["| Field | Value |", "|-------|-------|"];
  for (const [k, v] of entries) {
    lines.push(`| ${escapeMdCell(String(k))} | ${escapeMdCell(String(v))} |`);
  }
  return lines.join("\n");
}

/**
 * A plain-text column table, sized to its widest cell per column.
 *
 * Columns are the union of every row's keys, matching `mdRecordTable`. Reading
 * them off the first row alone dropped whole columns when a field is
 * conditional — `channels list` omits `browser_session` on server-published
 * channels, so one such channel sorted first hid the field for every row below.
 */
export function formatColumnTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "(none)";
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const widths = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k] ?? "").length)));
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  const header = keys.map((k, i) => k.padEnd(widths[i]!)).join("  ");
  const lines = rows.map((r) => keys.map((k, i) => String(r[k] ?? "").padEnd(widths[i]!)).join("  "));
  return [header, sep, ...lines].join("\n");
}
