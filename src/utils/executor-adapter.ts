/**
 * Bridges the apcore-js Executor (which has call()) to the apcore-cli
 * Executor interface (which requires execute()). Also forwards optional
 * methods so --trace, --stream, --dry-run, and approval features work.
 */

import type { Executor, PipelineTrace } from "apcore-cli";
import type { Executor as ApCoreExecutor } from "apcore-js";
import { UserError } from "./errors.ts";

function rethrowUserError(err: unknown): never {
  if (err instanceof UserError) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
  // apcore-js wraps module errors as MODULE_EXECUTE_ERROR; reason lives in details.reason
  const record = err as Record<string, unknown>;
  if (record?.code === "MODULE_EXECUTE_ERROR") {
    const details = record?.details as Record<string, unknown> | undefined;
    const reason = (details?.reason as string) ?? "";
    if (reason.includes("UserError:")) {
      const inner = reason.replace(/^Module '[^']+' raised UserError: /, "");
      process.stderr.write(`Error: ${inner}\n`);
      process.exit(1);
    }
  }
  throw err;
}

function isMarkdownFormat(): boolean {
  const idx = process.argv.indexOf("--format");
  return idx !== -1 && process.argv[idx + 1] === "markdown";
}

function escapeMdCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
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

/**
 * If --format markdown is set and a module returned a non-string value, render
 * it generically as markdown so apcore-cli's formatExecResult doesn't fall
 * through to JSON.stringify. Modules that build their own markdown string
 * already return a string and bypass this layer.
 */
function maybeRenderMarkdown(result: unknown): unknown {
  if (!isMarkdownFormat()) return result;
  if (result === null || result === undefined) return result;
  if (typeof result === "string") return result;
  if (Array.isArray(result)) return renderArrayMarkdown(result);
  if (typeof result === "object") return renderObjectMarkdown(result as Record<string, unknown>);
  return result;
}

export class ExecutorAdapter implements Executor {
  constructor(private readonly inner: ApCoreExecutor) {}

  async execute(moduleId: string, input: Record<string, unknown>): Promise<unknown> {
    const result = await this.inner.call(moduleId, input).catch(rethrowUserError);
    return maybeRenderMarkdown(result);
  }

  async call(moduleId: string, input: Record<string, unknown>): Promise<unknown> {
    const result = await this.inner.call(moduleId, input).catch(rethrowUserError);
    return maybeRenderMarkdown(result);
  }

  async validate(moduleId: string, input: Record<string, unknown>) {
    return this.inner.validate(moduleId, input) as Promise<import("apcore-cli").PreflightResult>;
  }

  async callWithTrace(
    moduleId: string,
    input: Record<string, unknown>,
    _options?: { strategy?: string },
  ): Promise<[unknown, PipelineTrace]> {
    // Strategy-by-name selection requires apcore-js strategy registry access
    // which is not yet bridged — executor uses its currently-configured strategy.
    const result = (await this.inner.callWithTrace(moduleId, input)) as [unknown, PipelineTrace];
    return [maybeRenderMarkdown(result[0]), result[1]];
  }

  stream(moduleId: string, input: Record<string, unknown>): AsyncIterable<unknown> {
    return this.inner.stream(moduleId, input) as AsyncIterable<unknown>;
  }
}
