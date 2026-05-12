/**
 * Centralized output format detection logic.
 */

export const PRESENTATION_FORMATS = ["tui", "table", "markdown"];

export function getOutputFormat(): string {
  const idx = process.argv.indexOf("--format");
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  
  // Default logic: TUI for humans, JSON/Table for machines/pipes
  if (process.stdout.isTTY) {
    return "tui";
  }
  
  return process.env.CI ? "json" : "table";
}

export function isPresentationFormat(format: string): boolean {
  return PRESENTATION_FORMATS.includes(format);
}

export function isTty(): boolean {
  return process.stdout.isTTY;
}
