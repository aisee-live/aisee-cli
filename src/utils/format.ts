/**
 * Centralized output format detection logic.
 */

export const PRESENTATION_FORMATS = ["tui", "table", "markdown"];

/**
 * Read an explicit `--format`, falling back to the caller's own defaults.
 *
 * Command groups do not agree on those defaults — `post` renders a table on a
 * TTY and JSON when piped, while everything else renders TUI and table. That
 * divergence predates this helper and is deliberately preserved here: changing
 * what `aisee post list` emits when piped would break any script consuming it,
 * so unifying the defaults is a separate, breaking decision. What this removes
 * is the duplicated argv parsing, not the disagreement.
 */
export function resolveFormat(defaults: { tty: string; piped: string }): string {
  const idx = process.argv.indexOf("--format");
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return process.stdout.isTTY ? defaults.tty : defaults.piped;
}

export function getOutputFormat(): string {
  // TUI for humans, JSON/table for machines and pipes.
  return resolveFormat({ tty: "tui", piped: process.env.CI ? "json" : "table" });
}

export function isPresentationFormat(format: string): boolean {
  return PRESENTATION_FORMATS.includes(format);
}

export function isTty(): boolean {
  return process.stdout.isTTY;
}
