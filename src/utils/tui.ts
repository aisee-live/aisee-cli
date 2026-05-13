import chalk from "chalk";
import { spawnSync } from "child_process";

/**
 * AISee TUI Design System
 *
 * Detects light vs dark terminal background and picks appropriate neutral
 * shades so text is readable on both. Accent colors stay constant.
 *
 * Override detection with: AISEE_THEME=light | dark
 *
 * Detection order:
 *   1. AISEE_THEME env var (explicit override)
 *   2. COLORFGBG env var (set by xterm, some Terminal.app configs)
 *   3. Terminal-specific env vars (ITERM_PROFILE)
 *   4. OS-level theme (macOS AppleInterfaceStyle)
 *   5. Default: dark
 */

function isLightBackground(): boolean {
  const theme = process.env.AISEE_THEME?.toLowerCase();
  if (theme === "light") return true;
  if (theme === "dark") return false;

  // 1. COLORFGBG: "fg;bg" — bg 7 (ANSI white) or 15 (bright white) → light background.
  const fgbg = process.env.COLORFGBG;
  if (fgbg) {
    const bg = parseInt(fgbg.split(";").pop() ?? "", 10);
    // 0-6, 8-9 are usually dark; 7, 10-15 are light
    if ((bg >= 0 && bg <= 6) || bg === 8 || bg === 9) return false;
    if (bg === 7 || (bg >= 10 && bg <= 15)) return true;
  }

  // 2. macOS Precise Terminal Detection (AppleScript)
  // Queries the actual terminal window's background color.
  if (process.platform === "darwin") {
    const program = process.env.TERM_PROGRAM;
    let script = "";
    if (program === "Apple_Terminal") {
      script = 'tell application "Terminal" to get background color of window 1';
    } else if (program === "iTerm.app") {
      script = 'tell application "iTerm" to get background color of current session of current window';
    }

    if (script) {
      try {
        const result = spawnSync("osascript", ["-e", script], { encoding: "utf8", timeout: 500 });
        if (result.status === 0) {
          const parts = result.stdout.split(",").map((s) => parseInt(s.trim(), 10));
          if (parts.length === 3) {
            // Perceived luminance formula (ITU-R BT.709)
            // Values are 16-bit (0-65535)
            const luminance = (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) / 65535;
            return luminance > 0.5;
          }
        }
      } catch {
        // ignore and fall through
      }
    }
  }

  // 3. iTerm2 profile detection fallback
  if (process.env.ITERM_PROFILE?.toLowerCase().includes("light")) return true;
  if (process.env.ITERM_PROFILE?.toLowerCase().includes("dark")) return false;

  // 4. macOS system-wide detection (final hint)
  if (process.platform === "darwin") {
    try {
      const result = spawnSync("defaults", ["read", "-g", "AppleInterfaceStyle"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 500,
      });
      if (result.stdout.trim() === "Dark") return false;
      return true; // Key missing or not "Dark" usually means Light mode
    } catch {
      // Key missing on macOS often means Light mode
      return true;
    }
  }

  // Default: dark for safety
  return false;
}


const light = isLightBackground();

export const colors = {
  // Accent colors — dark terminal palette (original)
  lime: light ? chalk.hex("#5a8a00")  : chalk.hex("#c8ff00"),
  cyan: light ? chalk.hex("#0070a0")  : chalk.hex("#9cdcfe"),
  orange: light ? chalk.hex("#a04820") : chalk.hex("#ce9178"),
  yellow: light ? chalk.hex("#7a6c00") : chalk.hex("#dcdcaa"),
  green: light ? chalk.hex("#1a7a60")  : chalk.hex("#4ec9b0"),
  red: light ? chalk.hex("#b02020")    : chalk.hex("#f44747"),
  gold: light ? chalk.hex("#b06800")   : chalk.hex("#febc2e"),
  blue: light ? chalk.hex("#1450a0")   : chalk.hex("#569cd6"),
  // Neutral shades — swap to high-contrast darks on light backgrounds
  dim:   light ? chalk.hex("#888") : chalk.hex("#555"),
  gray:  light ? chalk.hex("#444") : chalk.hex("#888"),
  white: light ? chalk.hex("#111") : chalk.hex("#eee"),
};

const ANSI_RE = /\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

export function getTerminalWidth(): number {
  const cols = process.stdout.columns;
  if (!cols || cols < 40) return 90;
  return Math.min(cols, 110);
}

/**
 * Word-wrap a single line (no embedded \n) preserving ANSI styling per chunk.
 * Falls back to a hard slice for tokens longer than `width`.
 */
function wrapLine(text: string, width: number): string[] {
  if (visibleLength(text) <= width) return [text];
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current + w;
    if (visibleLength(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current.trim()) lines.push(current.trimEnd());
    if (visibleLength(w) > width) {
      let rest = w;
      while (visibleLength(rest) > width) {
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      current = rest;
    } else {
      current = w.trimStart();
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines;
}

export function wrapWithIndent(text: string, width: number, indent: string = ""): string[] {
  const innerWidth = Math.max(10, width - visibleLength(indent));
  const out: string[] = [];
  text.split("\n").forEach((line) => {
    if (!line) {
      out.push(indent);
      return;
    }
    wrapLine(line, innerWidth).forEach((w) => out.push(indent + w));
  });
  return out;
}

export function renderProgressBar(score: number, width: number = 15): string {
  const n = Number(score);
  const scoreVal = isNaN(n) ? 0 : n;
  const filledCount = Math.max(0, Math.min(width, Math.round((scoreVal / 100) * width)));
  const emptyCount = width - filledCount;

  let color = colors.red;
  if (scoreVal >= 80) color = colors.green;
  else if (scoreVal >= 60) color = colors.yellow;
  else if (scoreVal >= 40) color = colors.orange;

  return colors.dim("[") + color("▓".repeat(filledCount)) + colors.dim("░".repeat(emptyCount)) + colors.dim("]");
}

export function renderGrade(grade: string): string {
  const g = String(grade).toUpperCase();
  if (g.startsWith("A")) return colors.green.bold(` ${g} `);
  if (g.startsWith("B")) return colors.yellow.bold(` ${g} `);
  if (g.startsWith("C")) return colors.orange.bold(` ${g} `);
  return colors.red.bold(` ${g} `);
}

export function renderSectionHeader(moduleName: string, title: string): string {
  return `${colors.dim(`[${moduleName.toUpperCase()}]`)} ${colors.lime.bold(title)}`;
}

export function renderRule(width: number = getTerminalWidth(), char: string = "─"): string {
  return colors.dim(char.repeat(width));
}

export function renderDivider(width: number = getTerminalWidth()): string {
  return colors.dim("· ".repeat(Math.floor(width / 2)));
}

export function renderKV(key: string, value: string | number, keyWidth: number = 18): string {
  const k = colors.gray(String(key).padEnd(keyWidth));
  const v = colors.white(String(value));
  return `${k} ${v}`;
}

function difficultyColor(difficulty: string) {
  const d = difficulty.toLowerCase();
  if (d.includes("easy")) return colors.green;
  if (d.includes("hard")) return colors.red;
  return colors.yellow;
}

function statusBadge(status: string): string {
  const s = status.toLowerCase();
  if (s === "completed" || s === "done") return colors.green(`● ${status}`);
  if (s === "in_progress" || s === "running") return colors.blue(`● ${status}`);
  if (s === "pending") return colors.gray(`○ ${status}`);
  return colors.dim(`· ${status}`);
}

function impactStars(impact: number): string {
  const n = Math.max(0, Math.min(5, Math.round(impact)));
  return colors.yellow("★".repeat(n)) + colors.dim("☆".repeat(5 - n));
}

/**
 * Render a single action item as a card.
 * Layout:
 *   #sn  Title                                        [difficulty]  ★★★★☆
 *   ↳ category · 17.2 → 25.0 (+7.8) · ● pending
 *     Description text, wrapped to the indent column.
 */
export function renderActionCard(item: Record<string, any>, width: number = getTerminalWidth()): string {
  const sn = item.sn ?? item.id ?? "";
  const title = String(item.title ?? "(untitled)");
  const difficulty = String(item.difficulty ?? "medium");
  const impact = Number(item.impact ?? 3);
  const category = item.category ? String(item.category) : "";
  const status = item.status ? String(item.status) : "";
  const toNum = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const current = toNum(item.current_score);
  const expected = toNum(item.expected_score);
  const description = item.description ? String(item.description) : "";

  const idTag = colors.orange.bold(`#${String(sn).padEnd(2)}`);
  const stars = impactStars(impact);
  const diffTag = difficultyColor(difficulty)(`[${difficulty}]`);

  // Right-side tags: difficulty + stars, fixed visible widths
  const right = `${diffTag}  ${stars}`;
  const titleStyled = colors.white.bold(title);
  const headerLeft = `${idTag}  ${titleStyled}`;
  const gap = Math.max(2, width - visibleLength(headerLeft) - visibleLength(right));
  const header = headerLeft + " ".repeat(gap) + right;

  const metaParts: string[] = [];
  if (item.id) metaParts.push(`${colors.dim("id")} ${colors.gold(String(item.id))}`);
  if (category) metaParts.push(colors.cyan(category));
  if (current !== null && expected !== null) {
    const delta = expected - current;
    const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
    const deltaColor = delta > 0 ? colors.green : colors.dim;
    metaParts.push(
      `${colors.white(current.toFixed(1))} ${colors.dim("→")} ${colors.white(expected.toFixed(1))} ${deltaColor(`(${deltaStr})`)}`,
    );
  }
  if (status) metaParts.push(statusBadge(status));
  const meta = colors.dim("  ↳ ") + metaParts.join(colors.dim(" · "));

  const lines = [header, meta];
  if (description) {
    const wrapped = wrapWithIndent(description, width, "      ");
    wrapped.forEach((l) => lines.push(colors.gray(l)));
  }
  return lines.join("\n");
}

/**
 * Apply inline markdown styling: **bold**, _italic_, `code`.
 * Order matters — handle code first so its contents aren't re-parsed.
 */
function applyInlineMd(text: string): string {
  const codeTokens: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_, m) => {
    codeTokens.push(colors.orange(m));
    return ` ${codeTokens.length - 1} `;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, m) => colors.white.bold(m));
  out = out.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, (_, pre, m) => `${pre}${colors.gray.italic(m)}`);
  out = out.replace(/(^|[^_])_([^_\s][^_]*?)_(?!_)/g, (_, pre, m) => `${pre}${colors.gray.italic(m)}`);
  out = out.replace(/ (\d+) /g, (_, idx) => codeTokens[Number(idx)]);
  return out;
}

function isTableSeparator(cells: string[]): boolean {
  return cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function renderMdTable(rows: string[]): string {
  const parsed = rows.map(parseTableRow);
  const headerIdx = parsed.findIndex(isTableSeparator) - 1;
  const dataRows = parsed.filter((p) => !isTableSeparator(p));
  if (dataRows.length === 0) return "";
  const cols = Math.max(...dataRows.map((r) => r.length));
  const widths = Array<number>(cols).fill(0);
  dataRows.forEach((r) =>
    r.forEach((c, i) => {
      widths[i] = Math.max(widths[i], visibleLength(c));
    }),
  );

  const lines: string[] = [];
  dataRows.forEach((row, idx) => {
    const cells = row.map((c, i) => {
      const styled = idx === headerIdx ? colors.lime.bold(c) : applyInlineMd(c);
      const pad = " ".repeat(Math.max(0, widths[i] - visibleLength(c)));
      return styled + pad;
    });
    lines.push("  " + cells.join(colors.dim("  │  ")));
    if (idx === headerIdx) {
      lines.push("  " + widths.map((w) => colors.dim("─".repeat(w))).join(colors.dim("──┼──")));
    }
  });
  return lines.join("\n");
}

/**
 * Render a markdown string with TUI styling: colored headers, styled tables,
 * bullet/numbered lists, blockquotes, code blocks, and inline formatting.
 */
export function renderMarkdownToTui(md: string): string {
  const lines = md.split("\n");
  const width = getTerminalWidth();
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      i++;
      const code: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++;
      code.forEach((c) => out.push(colors.dim("    │ ") + colors.orange(c)));
      out.push("");
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      out.push(renderMdTable(tableLines));
      out.push("");
      continue;
    }

    const h1 = line.match(/^# (.+)$/);
    if (h1) {
      out.push("");
      out.push(colors.lime.bold(h1[1].trim()));
      out.push(renderRule(Math.min(width, visibleLength(h1[1]) + 8)));
      i++;
      continue;
    }
    const h2 = line.match(/^## (.+)$/);
    if (h2) {
      out.push("");
      out.push(colors.lime.bold("▍ ") + colors.white.bold(applyInlineMd(h2[1].trim())));
      i++;
      continue;
    }
    const h3 = line.match(/^### (.+)$/);
    if (h3) {
      out.push("");
      out.push(colors.cyan.bold(applyInlineMd(h3[1].trim())));
      i++;
      continue;
    }
    const h4 = line.match(/^#### (.+)$/);
    if (h4) {
      out.push(colors.gold.bold(applyInlineMd(h4[1].trim())));
      i++;
      continue;
    }

    if (line.startsWith("> ")) {
      out.push(colors.dim("│ ") + colors.gray(applyInlineMd(line.slice(2))));
      i++;
      continue;
    }

    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bullet) {
      const indent = bullet[1].length;
      const body = applyInlineMd(bullet[2]);
      out.push(" ".repeat(indent) + colors.lime("• ") + body);
      i++;
      continue;
    }

    const numbered = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numbered) {
      out.push(
        " ".repeat(numbered[1].length) + colors.orange(numbered[2] + ". ") + applyInlineMd(numbered[3]),
      );
      i++;
      continue;
    }

    if (/^-{3,}$/.test(line.trim())) {
      out.push(renderRule());
      i++;
      continue;
    }

    if (line.trim() === "") {
      out.push("");
      i++;
      continue;
    }

    out.push(applyInlineMd(line));
    i++;
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Render a single generic item (no special fields) as a labeled card.
 */
export function renderRecordCard(item: Record<string, any>, width: number = getTerminalWidth()): string {
  const entries = Object.entries(item).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return colors.dim("(empty)");
  const keyWidth = Math.min(20, Math.max(...entries.map(([k]) => k.length)));
  return entries
    .map(([k, v]) => {
      const value = typeof v === "object" ? JSON.stringify(v) : String(v);
      const wrapped = wrapWithIndent(value, width, " ".repeat(keyWidth + 3));
      const first = `${colors.gray(k.padEnd(keyWidth))}   ${colors.white(wrapped[0].trimStart())}`;
      return [first, ...wrapped.slice(1)].join("\n");
    })
    .join("\n");
}
