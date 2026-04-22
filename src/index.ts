import { createCli, registerDiscoveryCommands, GroupedModuleGroup, LazyGroup } from "apcore-cli";
import { Registry, APCore } from "apcore-js";
import { getAppConfig, initDefaultConfig } from "./utils/config.ts";
import { loginModule, logoutModule, whoamiModule } from "./modules/auth.ts";
import {
  scanModule,
  reportModule,
  actionsListModule,
  actionsSuggestModule,
  actionsPostModule
} from "./modules/analysis/index.ts";
import {
  postCreateModule,
  postListModule,
  postDashboardModule,
  postPublishModule,
  postScheduleModule,
  channelListModule,
  channelAddModule,
  channelRemoveModule
} from "./modules/post/index.ts";
import { configListModule, configSetModule, configSpecModule } from "./modules/config.ts";
import { Command } from "commander";

class RegistryAdapter {
  constructor(private registry: Registry) {}
  listModules() {
    return this.registry.list().map(id => this.getModule(id)).filter(m => m !== null) as any[];
  }
  getModule(moduleId: string) {
    const def = this.registry.getDefinition(moduleId);
    if (!def) return null;
    return {
      ...def,
      id: def.moduleId,
      inputSchema: def.inputSchema,
      outputSchema: def.outputSchema,
      metadata: def.metadata || {}
    };
  }
}

class ExecutorAdapter {
  constructor(private executor: any) {}
  async execute(moduleId: string, input: Record<string, unknown>) {
    return this.executor.call(moduleId, input);
  }
  async validate(moduleId: string, input: Record<string, unknown>) {
    if (this.executor.validate) {
      return this.executor.validate(moduleId, input);
    }
    throw new Error("Executor does not support validate");
  }
  describePipeline(strategyName?: string) {
    return this.executor.describePipeline?.(strategyName);
  }
  get strategy() {
    return (this.executor as any).strategy;
  }
}

function patchCommandForPositionalArgs(cmd: Command, argNames: string[]) {
  const originalAction = (cmd as any)._actionHandler;
  if (!originalAction) return;
  (cmd as any)._args = [];
  for (const name of argNames) {
    const isOptional = name.startsWith("[") && name.endsWith("]");
    const cleanName = name.replace(/[\[\]<>]/g, "");
    if (isOptional) {
      cmd.argument(`[${cleanName}]`, `Positional argument: ${cleanName}`);
    } else {
      cmd.argument(`<${cleanName}>`, `Positional argument: ${cleanName}`);
    }
  }
  cmd.action(async (...args: any[]) => {
    const options = args[args.length - 1];
    const positionalValues = args.slice(0, args.length - 1);
    argNames.forEach((name, i) => {
      const cleanName = name.replace(/[\[\]<>]/g, "");
      if (positionalValues[i] !== undefined) {
        options[cleanName] = positionalValues[i];
      }
    });
    return originalAction.call(cmd, options);
  });
}

const registry = new Registry();
registry.register("aisee_config.list", configListModule);
registry.register("aisee_config.set", configSetModule);
registry.register("aisee_config.spec", configSpecModule);
registry.register("auth.login", loginModule);
registry.register("auth.logout", logoutModule);
registry.register("auth.whoami", whoamiModule);
registry.register("scan", scanModule);
registry.register("report", reportModule);
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

async function main() {
  await initDefaultConfig();
  const config = await getAppConfig();
  const app = new APCore({ registry, config });
  const adaptedExecutor = new ExecutorAdapter(app.executor) as any;
  const adaptedRegistry = new RegistryAdapter(registry) as any;
  const cli = createCli({
    app: {
      ...app,
      executor: adaptedExecutor,
      registry: adaptedRegistry
    } as any,
    progName: "aisee",
    verbose: false
  });
  (cli as any)._commands = cli.commands.filter(c => c.name() !== "list" && c.name() !== "describe");
  registerDiscoveryCommands(cli, adaptedRegistry);
  try {
    const grouped = new GroupedModuleGroup(adaptedRegistry, adaptedExecutor);
    grouped.buildGroupMap();
    const groupNames = [...(grouped as any).groupMap.keys()];
    for (const groupName of groupNames) {
      if (["list", "describe", "init", "help", "validate", "describe-pipeline"].includes(groupName)) continue;
      
      const groupCmd = grouped.getCommand(groupName);
      if (groupCmd) {
        const lazyGroup = (grouped as any).groupCache.get(groupName);
        if (lazyGroup) {
          if (groupName === "actions") {
            const list = lazyGroup.getCommand("list");
            if (list) patchCommandForPositionalArgs(list, ["<url>"]);
            const suggest = lazyGroup.getCommand("suggest");
            if (suggest) patchCommandForPositionalArgs(suggest, ["<url>", "<taskId>"]);
            const post = lazyGroup.getCommand("post");
            if (post) patchCommandForPositionalArgs(post, ["<url>", "<taskId>"]);
          } else if (groupName === "channels") {
            const add = lazyGroup.getCommand("add");
            if (add) patchCommandForPositionalArgs(add, ["<platform>"]);
            const remove = lazyGroup.getCommand("remove");
            if (remove) patchCommandForPositionalArgs(remove, ["<id>"]);
          }
        }
        if (groupName === "aisee_config") {
          const specCmd = lazyGroup.getCommand("spec");
          if (specCmd) patchCommandForPositionalArgs(specCmd, ["<service>"]);
        }

        cli.addCommand(groupCmd);
      }
    }
    for (const [name] of (grouped as any).topLevelModules) {
      const cmd = grouped.getCommand(name);
      if (cmd) {
        if (name === "scan") {
          patchCommandForPositionalArgs(cmd, ["<url>"]);
        } else if (name === "report") {
          patchCommandForPositionalArgs(cmd, ["<url>", "[section]"]);
        }
        cli.addCommand(cmd);
      }
    }
  } catch (err) {
    // console.error("DEBUG: buildGroupMap error:", err);
  }
  try {
    cli.parse(process.argv);
  } catch (err: any) {
    if (err.code === "commander.helpDisplayed" || err.code === "commander.version") {
      process.exit(0);
    }
    throw err;
  }
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
