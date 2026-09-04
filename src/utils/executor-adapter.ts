/**
 * Bridges the apcore-js Executor (which has call()) to the apcore-cli
 * Executor interface (which requires execute()). Also forwards optional
 * methods so --trace, --stream, --dry-run, and approval features work.
 */

import type { Executor, PipelineTrace } from "apcore-cli";
import type { Executor as ApCoreExecutor } from "apcore-js";
import { UserError } from "./errors.ts";
import {
  colors,
  renderKV,
  renderProgressBar,
  renderGrade,
  renderSectionHeader,
  renderActionCard,
  renderRecordCard,
  renderRule,
  getTerminalWidth,
} from "./tui.ts";
import { getOutputFormat } from "./format.ts";
import { escapeMdCell } from "./table.ts";

function rethrowUserError(err: unknown): never {
  if (err instanceof UserError) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
  const record = err as Record<string, unknown>;
  if (record?.code === "MODULE_EXECUTE_ERROR") {
    const details = record?.details as Record<string, unknown> | undefined;
    const reason = (details?.reason as string) ?? (record?.message as string) ?? String(err);
    const inner = reason.replace(/^Module '[^']+' raised \w+: /, "");
    if (process.stderr.isTTY) {
      process.stderr.write(`Error: ${inner}\n`);
    } else {
      process.stderr.write(JSON.stringify({ error: true, code: "MODULE_EXECUTE_ERROR", message: inner, exit_code: 1 }) + "\n");
    }
    process.exit(1);
  }
  throw err;
}

function renderObjectMarkdown(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "_(empty)_\n";
  const lines = ["| Field | Value |", "|-------|-------|"];
  for (const [k, v] of entries) {
    const value = v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    lines.push(`| ${escapeMdCell(k)} | ${escapeMdCell(value)} |`);
  }
  return lines.join("\n") + "\n";
}

function renderArrayMarkdown(arr: unknown[]): string {
  if (arr.length === 0) return "_(empty)_\n";
  const allObjects = arr.every((v) => v !== null && typeof v === "object" && !Array.isArray(v));
  if (allObjects) {
    const records = arr as Record<string, unknown>[];
    const keys = [...new Set(records.flatMap((r) => Object.keys(r)))];
    const lines = [
      "| " + keys.map(escapeMdCell).join(" | ") + " |",
      "| " + keys.map(() => "---").join(" | ") + " |",
    ];
    for (const r of records) {
      lines.push(
        "| " +
          keys
            .map((k) => {
              const v = r[k];
              const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
              return escapeMdCell(s);
            })
            .join(" | ") +
          " |",
      );
    }
    return lines.join("\n") + "\n";
  }
  return arr.map((v) => `- ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("\n") + "\n";
}

function renderPlain(result: any, prefix: string = ""): string {
  if (result === null || result === undefined) return "";
  if (typeof result !== "object") return `${prefix}${result}\n`;

  let output = "";
  for (const [key, value] of Object.entries(result)) {
    if (Array.isArray(value)) {
      output += `${prefix}${key}:\n`;
      value.forEach(item => {
        output += renderPlain(item, `${prefix}  - `);
      });
    } else if (typeof value === "object" && value !== null) {
      output += `${prefix}${key}:\n`;
      output += renderPlain(value, `${prefix}  `);
    } else {
      output += `${prefix}${key}: ${value}\n`;
    }
  }
  return output;
}

function isActionItem(item: unknown): item is Record<string, any> {
  if (!item || typeof item !== "object") return false;
  const i = item as Record<string, unknown>;
  return Boolean(i.title) && (i.difficulty !== undefined || i.impact !== undefined);
}

function findItemsArray(result: Record<string, any>): { key: string; items: any[] } | null {
  for (const [k, v] of Object.entries(result)) {
    if (Array.isArray(v) && v.length > 0 && v.every((x) => x !== null && typeof x === "object")) {
      return { key: k, items: v };
    }
  }
  return null;
}

function renderListHeader(moduleId: string, result: Record<string, any>, itemCount: number): string {
  const name = moduleId.split(".").pop() || moduleId;
  const stats: string[] = [];
  if (typeof result.total === "number") stats.push(`${colors.white.bold(String(result.total))} ${colors.dim("total")}`);
  else stats.push(`${colors.white.bold(String(itemCount))} ${colors.dim("items")}`);
  if (typeof result.page === "number" && typeof result.pages === "number") {
    stats.push(`${colors.dim("page")} ${colors.white(String(result.page))}${colors.dim("/")}${colors.white(String(result.pages))}`);
  }
  const left = renderSectionHeader(moduleId, name.toUpperCase());
  return `${left}  ${colors.dim("·")}  ${stats.join(`  ${colors.dim("·")}  `)}`;
}

function renderListResult(moduleId: string, result: Record<string, any>, items: any[]): string {
  const width = getTerminalWidth();
  const out: string[] = [];
  out.push("");
  out.push(renderListHeader(moduleId, result, items.length));
  out.push(renderRule(width));

  const allHaveModule = items.every((i) => typeof i.module === "string" && i.module);
  const renderItem = (item: Record<string, any>) =>
    isActionItem(item) ? renderActionCard(item, width) : renderRecordCard(item, width);

  if (allHaveModule) {
    const groups = new Map<string, Record<string, any>[]>();
    for (const it of items) {
      const key = String(it.module);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(it);
    }
    let first = true;
    for (const [module, groupItems] of groups) {
      if (!first) out.push("");
      first = false;
      out.push(colors.lime.bold(module.toUpperCase()) + colors.dim(`  (${groupItems.length})`));
      out.push("");
      groupItems.forEach((it, idx) => {
        out.push(renderItem(it));
        if (idx < groupItems.length - 1) out.push("");
      });
    }
  } else {
    items.forEach((it, idx) => {
      out.push(renderItem(it));
      if (idx < items.length - 1) out.push("");
    });
  }

  out.push(renderRule(width));
  out.push("");
  return out.join("\n");
}

function renderObjectResult(moduleId: string, result: Record<string, any>): string {
  const width = getTerminalWidth();
  const name = moduleId.split(".").pop() || moduleId;
  const lines: string[] = [];
  lines.push("");
  lines.push(renderSectionHeader(moduleId, name.toUpperCase()));
  lines.push(renderRule(width));

  for (const [key, value] of Object.entries(result)) {
    if (value === null || value === undefined) continue;
    if (key.toLowerCase().includes("score") && typeof value === "number") {
      lines.push(
        `${renderKV(key, value.toFixed(2))}  ${renderProgressBar(value)} ${renderGrade(
          value >= 80 ? "A" : value >= 60 ? "B" : "C",
        )}`,
      );
    } else if (Array.isArray(value)) {
      lines.push("");
      lines.push(colors.white.bold(key.toUpperCase()) + colors.dim(`  (${value.length})`));
      value.forEach((item, idx) => {
        if (item !== null && typeof item === "object") {
          lines.push(
            isActionItem(item)
              ? renderActionCard(item as Record<string, any>, width)
              : renderRecordCard(item as Record<string, any>, width),
          );
          if (idx < value.length - 1) lines.push("");
        } else {
          lines.push(colors.dim(`  - ${item}`));
        }
      });
    } else if (typeof value === "object") {
      lines.push("");
      lines.push(colors.white.bold(key.toUpperCase()));
      lines.push(renderRecordCard(value as Record<string, any>, width));
    } else {
      lines.push(renderKV(key, String(value)));
    }
  }
  lines.push(renderRule(width));
  lines.push("");
  return lines.join("\n");
}

function renderTui(moduleId: string, result: any): string {
  if (result === null || result === undefined) return "";
  if (typeof result !== "object") return String(result);

  if (Array.isArray(result)) {
    if (result.length === 0) return colors.dim("(empty)\n");
    return renderListResult(moduleId, { total: result.length }, result);
  }

  const itemsField = findItemsArray(result);
  if (itemsField && (typeof result.total === "number" || itemsField.items.length > 1)) {
    return renderListResult(moduleId, result, itemsField.items);
  }
  return renderObjectResult(moduleId, result);
}

function maybeRenderEnhanced(moduleId: string, result: unknown): unknown {
  const format = getOutputFormat();
  
  if (format === "tui") {
    if (typeof result === "string") return result;
    return renderTui(moduleId, result);
  }

  if (format === "markdown") {
    if (result === null || result === undefined) return result;
    if (typeof result === "string") return result;
    if (Array.isArray(result)) return renderArrayMarkdown(result);
    if (typeof result === "object") return renderObjectMarkdown(result as Record<string, unknown>);
  }

  return result;
}

export class ExecutorAdapter implements Executor {
  constructor(private readonly inner: ApCoreExecutor) {}

  async execute(moduleId: string, input: Record<string, unknown>): Promise<unknown> {
    const result = await this.inner.call(moduleId, input).catch(rethrowUserError);
    return maybeRenderEnhanced(moduleId, result);
  }

  async call(moduleId: string, input: Record<string, unknown>): Promise<unknown> {
    const result = await this.inner.call(moduleId, input).catch(rethrowUserError);
    return maybeRenderEnhanced(moduleId, result);
  }

  async validate(moduleId: string, input: Record<string, unknown>) {
    return this.inner.validate(moduleId, input) as Promise<import("apcore-cli").PreflightResult>;
  }

  async callWithTrace(
    moduleId: string,
    input: Record<string, unknown>,
    _options?: { strategy?: string },
  ): Promise<[unknown, PipelineTrace]> {
    const result = (await this.inner.callWithTrace(moduleId, input)) as [unknown, PipelineTrace];
    return [maybeRenderEnhanced(moduleId, result[0]), result[1]];
  }

  stream(moduleId: string, input: Record<string, unknown>): AsyncIterable<unknown> {
    return this.inner.stream(moduleId, input) as AsyncIterable<unknown>;
  }
}
