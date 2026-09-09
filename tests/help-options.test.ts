import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Help-surface tests.
 *
 * What these pin: `--all-options` was accepted by the root command and
 * advertised in every help footer, but the flag never reached apcore-cli's
 * command builder — so the built-in options (`--format`, `--fields`, ...)
 * stayed hidden no matter what the user typed, and `--format json` had no
 * discoverable entry point.
 *
 * The CLI is exercised as a subprocess because option visibility is decided
 * while `main()` builds the command tree. HOME is redirected to a throwaway
 * directory so the run never touches the real `~/.config/aisee`.
 */

const CLI_ENTRY = join(import.meta.dir, "..", "src", "index.ts");
const FAKE_HOME = mkdtempSync(join(tmpdir(), "aisee-help-"));

afterAll(() => {
  rmSync(FAKE_HOME, { recursive: true, force: true });
});

async function runHelp(args: string[]): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", CLI_ENTRY, ...args],
    env: { ...process.env, HOME: FAKE_HOME },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return stdout + stderr;
}

describe("command help", () => {
  it("should hide built-in options when --all-options is absent", async () => {
    const out = await runHelp(["scan", "--help"]);

    expect(out).toContain("--url <value>");
    expect(out).not.toContain("--format <format>");
    expect(out).toContain("Use --all-options to show all options");
  });

  it("should reveal built-in options when --all-options is passed", async () => {
    const out = await runHelp(["scan", "--help", "--all-options"]);

    expect(out).toContain("--format <format>");
    expect(out).toContain("--fields <fields>");
    expect(out).toContain("--dry-run");
    expect(out).toContain("--url <value>");
  });

  it("should keep the aisee-specific output formats on --format", async () => {
    const out = await runHelp(["report", "--help", "--all-options"]);

    expect(out).toContain("tui");
    expect(out).toContain("markdown");
  });
});

describe("root help", () => {
  it("should surface --format without requiring --all-options", async () => {
    const out = await runHelp(["--help"]);

    expect(out).toContain("Common options (available on every command)");
    expect(out).toContain("--format <format>");
    expect(out).toContain("aisee whoami --format json");
  });

  it("should hold the rarer common options back until --all-options", async () => {
    const compact = await runHelp(["--help"]);
    const full = await runHelp(["--help", "--all-options"]);

    expect(compact).not.toContain("--dry-run");
    expect(full).toContain("--dry-run");
    expect(full).toContain("-y, --yes");
  });
});
