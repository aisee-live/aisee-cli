#!/usr/bin/env node
import { createCli, buildModuleCommand, exitCodeForError } from "apcore-cli";
import type { ModuleDescriptor } from "apcore-cli";
import { APCore, Registry } from "apcore-js";
import { Command } from "commander";
import { getAppConfig, initDefaultConfig } from "./utils/config.ts";
import { setLogLevel } from "./utils/log-level.ts";
import { emitErrorTty, emitErrorJson } from "./utils/emit-error.ts";
import { loginModule, logoutModule, whoamiModule } from "./modules/auth.ts";
import {
  scanModule,
  modelsModule,
  reportModule,
  actionsListModule,
  actionsSuggestModule,
  actionsPostModule,
  actionDetailModule,
} from "./modules/analysis/index.ts";
import {
  postCreateModule,
  postListModule,
  postDashboardModule,
  postPendingModule,
  postPublishModule,
  postScheduleModule,
  channelListModule,
  channelAddModule,
  channelRemoveModule,
  channelSelectModule,
} from "./modules/post/index.ts";
import {
  planCreateModule,
  planStatusModule,
  planPostsModule,
  planActivateModule,
} from "./modules/plan/index.ts";
import { configListModule, configSetModule, configSpecModule } from "./modules/config.ts";
import { zodToJsonSchema } from "./utils/zod-to-schema.ts";
import { ExecutorAdapter } from "./utils/executor-adapter.ts";
import { RegistryAdapter } from "./utils/registry-adapter.ts";

import pkg from "../package.json" with { type: "json" };

interface AiseeModule {
  description: string;
  inputSchema?: any;
}

/**
 * Commander stores option values under the camelCase name derived from the
 * flag (`--action-id` → `actionId`), never under the schema's snake_case
 * field name. Any lookup keyed by the raw field name silently misses.
 */
function toCommanderKey(optName: string): string {
  return optName.replace(/[-_]([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/**
 * Map positional args to named options before the action fires.
 * Follows GNU convention: primary subject is positional, flags stay as --options.
 * Supports both `cmd <val>` and `cmd --opt <val>` transparently.
 *
 * Shows command help when a required positional is missing — apcore-cli ≥0.9.1
 * already catches the same case via schema validation (exit 45), but showing
 * the full help text is more useful for interactive users.
 */
function withPositionals(cmd: Command, ...optionNames: string[]): Command {
  cmd.hook("preAction", (thisCmd) => {
    optionNames.forEach((optName, i) => {
      const commanderKey = toCommanderKey(optName);
      const val = (thisCmd.args as string[])[i];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const source = (thisCmd as any).getOptionValueSource?.(commanderKey);
      if (val && (!thisCmd.getOptionValue(commanderKey) || source === "default" || source === undefined)) {
        thisCmd.setOptionValue(commanderKey, val);
      }
    });

    for (const optName of optionNames) {
      if (thisCmd.getOptionValue(toCommanderKey(optName)) == null) {
        if (process.stderr.isTTY) {
          process.stderr.write(`error: missing required argument <${optName}>\n\n`);
          process.stderr.write(thisCmd.helpInformation());
        } else {
          emitErrorJson(new Error(`missing required argument <${optName}>`), 1);
        }
        process.exit(1);
      }
    }
  });
  return cmd;
}

/**
 * Extend the --format option's `choices` to include "tui" and "markdown".
 * apcore-cli's buildModuleCommand restricts --format to a fixed set; we
 * inject custom formats so every aisee command can render results via our adapter.
 */
function withEnhancedFormats(cmd: Command): Command {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fmtOpt = cmd.options.find((o: any) => o.long === "--format") as any;
  if (fmtOpt && Array.isArray(fmtOpt.argChoices)) {
    const newChoices = ["tui", "markdown"];
    newChoices.forEach(choice => {
      if (!fmtOpt.argChoices.includes(choice)) {
        fmtOpt.argChoices.push(choice);
      }
    });
    fmtOpt.description = "Output format: tui, json, table, csv, yaml, jsonl, markdown.";
  }
  return cmd;
}

function withVerbose(cmd: Command): Command {
  return cmd.option("--verbose", "Show detailed output or return raw API response");
}

/** Every command carries these; the root command itself accepts none of them. */
const COMMON_OPTION_LINES = [
  "  --format <format>   Output format: tui, table, markdown, json, csv, yaml, jsonl",
  "  --fields <paths>    Comma-separated dot-paths to select from the result",
];

const EXTRA_COMMON_OPTION_LINES = [
  "  --input <source>    Read JSON input from a file path, or '-' to read from stdin",
  "  -y, --yes           Skip interactive approval prompts (for scripts and CI)",
  "  --dry-run           Run preflight checks without executing the command",
  "  --trace             Show execution pipeline trace with per-step timing",
  "  --stream            Stream output as JSONL (one JSON object per line)",
];

/**
 * apcore-cli attaches the built-in options (--format, --fields, ...) to each
 * subcommand, so the root help never mentions them on its own. Restate them
 * here: --format is the flag scripts reach for first, and leaving it behind
 * `--all-options` means discovering it requires already knowing to ask.
 */
function withCommonOptionsHelp(program: Command, showAll: boolean): Command {
  const lines = showAll
    ? [...COMMON_OPTION_LINES, ...EXTRA_COMMON_OPTION_LINES]
    : COMMON_OPTION_LINES;
  return program.addHelpText("after", [
    "",
    "Common options (available on every command):",
    ...lines,
    "",
    "Example: aisee whoami --format json",
    "",
  ].join("\n"));
}

function makeDescriptor(moduleId: string, mod: AiseeModule): ModuleDescriptor {
  return {
    id: moduleId,
    name: moduleId.split(".").pop()!,
    description: mod.description,
    tags: [],
    inputSchema: mod.inputSchema ? zodToJsonSchema(mod.inputSchema) : {},
    outputSchema: {},
  };
}

function buildAiseeCommand(
  descriptor: ModuleDescriptor,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  executor: any,
  helpTextMaxLength: number,
  cmdName: string,
): Command {
  return withEnhancedFormats(buildModuleCommand(descriptor, executor, helpTextMaxLength, cmdName));
}

async function main() {
  await initDefaultConfig();
  const config = await getAppConfig();

  const registry = new Registry();
  registry.register("scan", scanModule);
  registry.register("report", reportModule);
  registry.register("models", modelsModule);
  registry.register("auth.login", loginModule);
  registry.register("auth.logout", logoutModule);
  registry.register("auth.whoami", whoamiModule);
  registry.register("actions.list", actionsListModule);
  registry.register("actions.suggest", actionsSuggestModule);
  registry.register("actions.post", actionsPostModule);
  registry.register("actions.detail", actionDetailModule);
  registry.register("post.create", postCreateModule);
  registry.register("post.list", postListModule);
  registry.register("post.dashboard", postDashboardModule);
  registry.register("post.pending", postPendingModule);
  registry.register("post.publish", postPublishModule);
  registry.register("post.schedule", postScheduleModule);
  registry.register("channels.list", channelListModule);
  registry.register("channels.add", channelAddModule);
  registry.register("channels.remove", channelRemoveModule);
  registry.register("channels.select", channelSelectModule);
  registry.register("plan.create", planCreateModule);
  registry.register("plan.status", planStatusModule);
  registry.register("plan.posts", planPostsModule);
  registry.register("plan.activate", planActivateModule);
  registry.register("config.list", configListModule);
  registry.register("config.set", configSetModule);
  registry.register("config.spec", configSpecModule);

  const app = new APCore({ registry, config });
  const executor = new ExecutorAdapter(app.executor);
  const registryAdapter = new RegistryAdapter(registry);

  // apcore-cli latches `--all-options` into module state inside createCli; every
  // buildModuleCommand call afterwards reads that state to decide whether the
  // built-in options (--format, --fields, --dry-run, ...) show up in help.
  // Commander stops parsing at `--help`, so read the raw argv instead of opts().
  const showAllOptions = process.argv.includes("--all-options");

  // createCli bootstraps: audit logger, approval handler, canonical help formatter,
  // and the hidden apcli group (list/describe/exec/etc.) for power users.
  const program = createCli({
    registry: registryAdapter,
    executor,
    progName: "aisee",
    apcli: false,
    allOptions: showAllOptions,
    version: pkg.version,
    description: "AISee CLI — AI-powered visibility analysis and content optimization",
  });

  withCommonOptionsHelp(program, showAllOptions);

  program.hook("preAction", () => {
    const level = program.opts().logLevel as string | undefined;
    if (level) setLogLevel(level);
  });

  // Top-level commands  — scan/report take <url> positionally
  // scan uses 900s to exceed the internal 600s scanAndWait timeout
  program.addCommand(withPositionals(
    buildAiseeCommand(makeDescriptor("scan", scanModule), executor, 900, "scan"),
    "url",
  ));
  program.addCommand(withPositionals(
    withVerbose(buildAiseeCommand(makeDescriptor("report", reportModule), executor, 1000, "report")),
    "url",
  ));

  program.addCommand(buildAiseeCommand(makeDescriptor("models", modelsModule), executor, 1000, "models"));

  // auth — promoted to top-level per product spec
  program.addCommand(buildAiseeCommand(makeDescriptor("auth.login", loginModule), executor, 1000, "login"));
  program.addCommand(buildAiseeCommand(makeDescriptor("auth.logout", logoutModule), executor, 1000, "logout"));
  program.addCommand(buildAiseeCommand(makeDescriptor("auth.whoami", whoamiModule), executor, 1000, "whoami"));

  // actions <url> — list optimization tasks for a site
  program.addCommand(withPositionals(
    withVerbose(buildAiseeCommand(makeDescriptor("actions.list", actionsListModule), executor, 1000, "actions")),
    "url",
  ));

  // action-detail / action-suggest / action-post — top-level per docs/COMMANDS.md
  program.addCommand(withPositionals(
    buildAiseeCommand(makeDescriptor("actions.detail", actionDetailModule), executor, 1000, "action-detail"),
    "action_id",
  ));
  program.addCommand(withPositionals(
    buildAiseeCommand(makeDescriptor("actions.suggest", actionsSuggestModule), executor, 1000, "action-suggest"),
    "action_id",
  ));
  program.addCommand(withPositionals(
    buildAiseeCommand(makeDescriptor("actions.post", actionsPostModule), executor, 1000, "action-post"),
    "action_id",
  ));

  // post
  const post = program.command("post").description("Social post management");
  post.addCommand(buildAiseeCommand(makeDescriptor("post.create", postCreateModule), executor, 1000, "create"));
  post.addCommand(withVerbose(buildAiseeCommand(makeDescriptor("post.list", postListModule), executor, 1000, "list")));
  post.addCommand(buildAiseeCommand(makeDescriptor("post.dashboard", postDashboardModule), executor, 1000, "dashboard"));
  post.addCommand(buildAiseeCommand(makeDescriptor("post.pending", postPendingModule), executor, 1000, "pending"));
  post.addCommand(withPositionals(
    buildAiseeCommand(makeDescriptor("post.publish", postPublishModule), executor, 1000, "publish"),
    "id",
  ));
  post.addCommand(withPositionals(
    buildAiseeCommand(makeDescriptor("post.schedule", postScheduleModule), executor, 1000, "schedule"),
    "id",
    "time",
  ));

  // channels — add takes <platform>, remove takes <id>
  const channels = program.command("channels").description("Integration channels");
  channels.addCommand(buildAiseeCommand(makeDescriptor("channels.list", channelListModule), executor, 1000, "list"));
  channels.addCommand(withPositionals(
    buildAiseeCommand(makeDescriptor("channels.add", channelAddModule), executor, 1000, "add"),
    "platform",
  ));
  channels.addCommand(withPositionals(
    buildAiseeCommand(makeDescriptor("channels.remove", channelRemoveModule), executor, 1000, "remove"),
    "id",
  ));
  channels.addCommand(withPositionals(
    buildAiseeCommand(makeDescriptor("channels.select", channelSelectModule), executor, 1000, "select"),
    "url",
  ));

  // plan — operation plans turn a completed analysis into scheduled content
  const plan = program.command("plan").description("Operation plans");
  plan.addCommand(buildAiseeCommand(makeDescriptor("plan.create", planCreateModule), executor, 1000, "create"));
  plan.addCommand(buildAiseeCommand(makeDescriptor("plan.status", planStatusModule), executor, 1000, "status"));
  plan.addCommand(buildAiseeCommand(makeDescriptor("plan.posts", planPostsModule), executor, 1000, "posts"));
  plan.addCommand(buildAiseeCommand(makeDescriptor("plan.activate", planActivateModule), executor, 1000, "activate"));

  // config
  const conf = program.command("config").description("CLI configuration");
  conf.addCommand(buildAiseeCommand(makeDescriptor("config.list", configListModule), executor, 1000, "list"));
  conf.addCommand(withPositionals(
    buildAiseeCommand(makeDescriptor("config.set", configSetModule), executor, 1000, "set"),
    "key",
    "value",
  ));
  conf.addCommand(withPositionals(
    buildAiseeCommand(makeDescriptor("config.spec", configSpecModule), executor, 1000, "spec"),
    "service",
  ));

  try {
    await program.parseAsync(process.argv);
  } catch (err: unknown) {
    const errRecord = err as Record<string, unknown>;
    if (errRecord?.code === "commander.helpDisplayed" || errRecord?.code === "commander.version") {
      process.exit(0);
    }
    const exitCode = exitCodeForError(err);
    if (process.stderr.isTTY) {
      emitErrorTty(err, exitCode);
    } else {
      emitErrorJson(err, exitCode);
    }
    process.exit(exitCode);
  }
}

main().catch((err) => {
  emitErrorTty(err, 1);
  process.exit(1);
});
