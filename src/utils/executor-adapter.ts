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

export class ExecutorAdapter implements Executor {
  constructor(private readonly inner: ApCoreExecutor) {}

  async execute(moduleId: string, input: Record<string, unknown>): Promise<unknown> {
    return this.inner.call(moduleId, input).catch(rethrowUserError);
  }

  async call(moduleId: string, input: Record<string, unknown>): Promise<unknown> {
    return this.inner.call(moduleId, input).catch(rethrowUserError);
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
    const result = await this.inner.callWithTrace(moduleId, input);
    return result as unknown as [unknown, PipelineTrace];
  }

  stream(moduleId: string, input: Record<string, unknown>): AsyncIterable<unknown> {
    return this.inner.stream(moduleId, input) as AsyncIterable<unknown>;
  }
}
