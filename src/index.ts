#!/usr/bin/env bun
import { createCli, buildModuleCommand, exitCodeForError, emitErrorTty, emitErrorJson } from "apcore-cli";
import type { ModuleDescriptor } from "apcore-cli";
import { APCore, Registry } from "apcore-js";
import { Command } from "commander";
import { getAppConfig, initDefaultConfig } from "./utils/config.ts";
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

interface AiseeModule {
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (program as any).removeAllListeners("option:version");
  program.on("option:version", () => {
    process.stdout.write("1.0.0\n");
    process.exit(0);
  });

  // Top-level commands  — scan/report take <url> positionally
  program.addCommand(withPositionals(
    buildModuleCommand(makeDescriptor("scan", scanModule), executor),
    "url",
  ));
  program.addCommand(withPositionals(
    buildModuleCommand(makeDescriptor("report", reportModule), executor),
    "url",
  ));

  // auth — promoted to top-level per product spec
  program.addCommand(buildModuleCommand(makeDescriptor("auth.login", loginModule), executor, 1000, "login"));
  program.addCommand(buildModuleCommand(makeDescriptor("auth.logout", logoutModule), executor, 1000, "logout"));
  program.addCommand(buildModuleCommand(makeDescriptor("auth.whoami", whoamiModule), executor, 1000, "whoami"));

  // actions <url> — standalone list command, no subcommands
  program.addCommand(withPositionals(
    buildModuleCommand(makeDescriptor("actions.list", actionsListModule), executor, 1000, "actions"),
    "url",
  ));

  // action-suggest <url> <task-id> — top-level to avoid argv[2] ambiguity with subcommand names
  program.addCommand(withPositionals(
    buildModuleCommand(makeDescriptor("actions.suggest", actionsSuggestModule), executor, 1000, "action-suggest"),
    "url", "actionId",
  ));

  // post — publish takes <id>, schedule takes <id> <time>
  const post = program.command("post").description("Social media post commands");
  post.addCommand(buildModuleCommand(makeDescriptor("post.create", postCreateModule), executor, 1000, "create"));
  post.addCommand(buildModuleCommand(makeDescriptor("post.list", postListModule), executor, 1000, "list"));
  post.addCommand(buildModuleCommand(makeDescriptor("post.dashboard", postDashboardModule), executor, 1000, "dashboard"));
  post.addCommand(withPositionals(
    buildModuleCommand(makeDescriptor("post.publish", postPublishModule), executor, 1000, "publish"),
    "id",
  ));
  post.addCommand(withPositionals(
    buildModuleCommand(makeDescriptor("post.schedule", postScheduleModule), executor, 1000, "schedule"),
    "id",
    "time",
  ));

  // channels — add takes <platform>, remove takes <id>
  const channels = program.command("channels").description("Integration channels");
  channels.addCommand(buildModuleCommand(makeDescriptor("channels.list", channelListModule), executor, 1000, "list"));
  channels.addCommand(withPositionals(
    buildModuleCommand(makeDescriptor("channels.add", channelAddModule), executor, 1000, "add"),
    "platform",
  ));
  channels.addCommand(withPositionals(
    buildModuleCommand(makeDescriptor("channels.remove", channelRemoveModule), executor, 1000, "remove"),
    "id",
  ));

  // config
  const conf = program.command("config").description("CLI configuration");
  conf.addCommand(buildModuleCommand(makeDescriptor("config.list", configListModule), executor, 1000, "list"));
  conf.addCommand(buildModuleCommand(makeDescriptor("config.set", configSetModule), executor, 1000, "set"));
  conf.addCommand(buildModuleCommand(makeDescriptor("config.spec", configSpecModule), executor, 1000, "spec"));

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
