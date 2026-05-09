/**
 * Local error-emit helpers.
 *
 * apcore-cli 0.8.0 dropped `emitErrorTty` / `emitErrorJson` from its public
 * surface (they are now module-private inside `buildModuleCommand`). Module
 * execution errors are formatted and exited inside the command action; these
 * helpers exist only for the top-level `parseAsync` catch in `src/index.ts`,
 * which sees parse / commander errors and uncaught surprises.
 */

type ErrRecord = Record<string, unknown>;

function toRecord(e: unknown): { err: Error; record: ErrRecord } {
  const err = e instanceof Error ? e : new Error(String(e));
  return { err, record: err as unknown as ErrRecord };
}

export function emitErrorJson(e: unknown, exitCode: number): void {
  const { err, record } = toRecord(e);
  const payload: ErrRecord = {
    error: true,
    code: record.code ?? "UNKNOWN",
    message: err.message,
    exit_code: exitCode,
  };
  for (const field of ["details", "suggestion", "ai_guidance", "retryable", "user_fixable"]) {
    const val = record[field];
    if (val !== undefined && val !== null) payload[field] = val;
  }
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}

export function emitErrorTty(e: unknown, exitCode: number): void {
  const { err, record } = toRecord(e);
  const code = record.code;
  const header = code ? `Error [${code}]: ${err.message}` : `Error: ${err.message}`;
  process.stderr.write(`${header}\n`);

  const details = record.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    process.stderr.write("\n  Details:\n");
    for (const [k, v] of Object.entries(details as ErrRecord)) {
      process.stderr.write(`    ${k}: ${v}\n`);
    }
  }

  const suggestion = record.suggestion;
  if (suggestion) process.stderr.write(`\n  Suggestion: ${suggestion}\n`);

  const retryable = record.retryable;
  if (retryable !== undefined && retryable !== null) {
    const label = retryable ? "Yes" : "No (same input will fail again)";
    process.stderr.write(`  Retryable: ${label}\n`);
  }

  process.stderr.write(`\n  Exit code: ${exitCode}\n`);
}
