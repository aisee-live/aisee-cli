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
  reportModule,
  actionsListModule,
  actionsSuggestModule,
  actionsPostModule,
} from "./modules/analysis/index.ts";
import {
  postCreateModule,
  postListModule,
  postDashboardModule,
  postPublishModule,
  postScheduleModule,
  channelListModule,
  channelAddModule,
  channelRemoveModule,
} from "./modules/post/index.ts";
import { configListModule, configSetModule, configSpecModule } from "./modules/config.ts";
import { zodToJsonSchema } from "./utils/zod-to-schema.ts";
import { ExecutorAdapter } from "./utils/executor-adapter.ts";
import { RegistryAdapter } from "./utils/registry-adapter.ts";

import pkg from "./package.json" with { type: "json" };

interface AiseeModule {
  description: string;
  inputSchema?: any;
}

/**
 * Map positional args to named options before the action fires.
 * Follows GNU convention: primary subject is positional, flags stay as --options.
 * Supports both `cmd <val>` and `cmd --opt <val>` transparently.
 *
 * @param mappings  Ordered list of [positionalIndex, optionName] pairs.
 */
function withPositionals(cmd: Command, ...optionNames: string[]): Command {
  cmd.hook("preAction", (thisCmd) => {
    optionNames.forEach((optName, i) => {
      const val = (thisCmd.args as string[])[i];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const source = (thisCmd as any).getOptionValueSource?.(optName);
      if (val && (!thisCmd.getOptionValue(optName) || source === "default" || source === undefined)) {
        thisCmd.setOptionValue(optName, val);
      }
    });
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
  return cmd.option("--verbose", "Return raw API response instead of formatted output");
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
  registry.register("auth.login", loginModule);
  registry.register("auth.logout", logoutModule);
  registry.register("auth.whoami", whoamiModule);
  registry.register("actions.list", actionsListModule);
  registry.register("actions.suggest", actionsSuggestModule);
  registry.register("actions.post", actionsPostModule);
  registry.register("post.create", postCreateModule);
  registry.register("post.list", postListModule);
  registry.register("post.dashboard", postDashboardModule);
  registry.register("post.publish", postPublishModule);
  registry.register("post.schedule", postScheduleModule);
  registry.register("channels.list", channelListModule);
  registry.register("channels.add", channelAddModule);
  registry.register("channels.remove", channelRemoveModule);
  registry.register("config.list", configListModule);
  registry.register("config.set", configSetModule);
  registry.register("config.spec", configSpecModule);

  const app = new APCore({ registry, config });
  const executor = new ExecutorAdapter(app.executor);
  const registryAdapter = new RegistryAdapter(registry);

  // createCli bootstraps: audit logger, approval handler, canonical help formatter,
  // and the hidden apcli group (list/describe/exec/etc.) for power users.
  const program = createCli({
    registry: registryAdapter,
    executor,
    progName: "aisee",
    apcli: false,
    version: pkg.version,
    description: "AISee CLI — AI-powered visibility analysis and content optimization",
  });

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

  // auth — promoted to top-level per product spec
  program.addCommand(buildAiseeCommand(makeDescriptor("auth.login", loginModule), executor, 1000, "login"));
  program.addCommand(buildAiseeCommand(makeDescriptor("auth.logout", logoutModule), executor, 1000, "logout"));
  program.addCommand(buildAiseeCommand(makeDescriptor("auth.whoami", whoamiModule), executor, 1000, "whoami"));

  // actions <url> — list optimization tasks for a site
  program.addCommand(withPositionals(
    withVerbose(buildAiseeCommand(makeDescriptor("actions.list", actionsListModule), executor, 1000, "actions")),
    "url",
  ));

  // action-suggest <action-id> / action-post <action-id> — top-level per docs/COMMANDS.md
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
    if (errRecord?.code === "MODULE_EXECUTE_ERROR" && process.stderr.isTTY) {
      const reason = (errRecord?.reason as string) ?? (errRecord?.message as string) ?? String(err);
      const inner = reason.replace(/^Module '[^']+' raised \w+: /, "");
      process.stderr.write(`Error: ${inner}\n`);
      process.exit(1);
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
