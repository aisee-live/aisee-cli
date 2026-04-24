import { createCli } from "apcore-cli";
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
import chalk from "chalk";

class ExecutorAdapter {
  constructor(private executor: any) {}
  async execute(moduleId: string, input: Record<string, unknown>) {
    return this.executor.call(moduleId, input);
  }
}

function toCSV(data: any[]): string {
  if (!data || data.length === 0) return "";
  const headers = Object.keys(data[0]);
  const escape = (val: any) => {
    let str = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
    return `"${str.replace(/"/g, '""')}"`;
  };
  return [headers.join(","), ...data.map(item => headers.map(h => escape(item[h])).join(","))].join("\n");
}

function displayResult(result: any, format: string = 'table') {
  if (result === undefined || result === null) return;
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const isPaginated = result && typeof result === 'object' && Array.isArray(result.items);
  const items = isPaginated ? result.items : (Array.isArray(result) ? result : [result]);

  if (format === 'csv') {
    console.log(toCSV(items));
    return;
  }

  if (isPaginated) {
    console.log(chalk.cyan(`Total: ${result.total} | Page: ${result.page}/${result.pages} | Size: ${result.size}\n`));
  }

  if (items.length === 0) {
    console.log(chalk.yellow("No records found."));
    return;
  }

  if (!isPaginated && items.length === 1 && typeof items[0] === 'object' && !Array.isArray(items[0])) {
    const data = items[0];
    const keys = Object.keys(data);
    if (keys.length > 5) {
        const maxK = Math.max(...keys.map(k => k.length), 5);
        console.log(chalk.bold("FIELD".padEnd(maxK) + "  VALUE"));
        console.log("-".repeat(maxK) + "  " + "-".repeat(30));
        keys.forEach(k => {
          let v = data[k];
          if (typeof v === 'object' && v !== null) v = JSON.stringify(v);
          console.log(`${chalk.bold(k.toUpperCase().padEnd(maxK))}  ${v}`);
        });
        return;
    }
  }

  const allKeys = Object.keys(items[0] || {});
  const preferred = ['id', 'name', 'code', 'version_name', 'score', 'status', 'created_at', 'platform', 'connected'];
  let headers = preferred.filter(k => allKeys.includes(k));

  if (headers.length === 0) headers = allKeys.slice(0, 6);
  if (headers.length === 0) { console.log(JSON.stringify(items, null, 2)); return; }

  const widths: Record<string, number> = {};
  headers.forEach(h => {
    widths[h] = Math.max(h.length, ...items.map(item => String(item[h] ?? '').length));
    if (widths[h] > 40) widths[h] = 40;
  });

  console.log(headers.map(h => chalk.bold(h.replace(/_/g, ' ').toUpperCase().padEnd(widths[h]))).join("  "));
  console.log(headers.map(h => "-".repeat(widths[h])).join("  "));

  items.forEach(item => {
    console.log(headers.map(h => {
      let val = item[h];
      if (typeof val === 'number' && (h === 'score' || h === 'total_score')) val = val.toFixed(2);
      if (h === 'created_at' && typeof val === 'string') val = val.split('.')[0].replace('T', ' ');
      let str = String(val ?? '').slice(0, widths[h]);
      const low = str.toLowerCase();
      if (['status', 'connected'].includes(h)) {
        if (['completed', 'published', 'true', 'active'].includes(low)) return chalk.green(str.padEnd(widths[h]));
        if (['failed', 'error', 'false', 'inactive'].includes(low)) return chalk.red(str.padEnd(widths[h]));
        return chalk.yellow(str.padEnd(widths[h]));
      }
      return str.padEnd(widths[h]);
    }).join("  "));
  });
}

function registerModule(parent: Command, moduleId: string, mod: any, executor: ExecutorAdapter, posArgs: string[] = []) {
    const name = moduleId.split('.').pop()!;
    let cmd = parent.commands.find(c => c.name() === name);
    if (!cmd) {
        cmd = new Command(name);
        parent.addCommand(cmd);
    }
    
    cmd.description(mod.description || "");
    posArgs.forEach(arg => cmd.argument(arg));

    if (mod.inputSchema && mod.inputSchema.shape) {
        Object.entries(mod.inputSchema.shape).forEach(([key, schema]: [string, any]) => {
            if (posArgs.some(a => a.includes(key))) return;
            const desc = schema.description || "";
            const isBool = schema._def.typeName === "ZodBoolean" || 
                          (schema._def.innerType && (schema._def.innerType._def.typeName === "ZodBoolean" || (schema._def.innerType._def.innerType && schema._def.innerType._def.innerType._def.typeName === "ZodBoolean")));
            
            // For the report command, we force use of --version if it's in schema
            if (isBool) cmd.option(`--${key}`, desc);
            else cmd.option(`--${key} <value>`, desc);
        });
    }

    if (!cmd.options.find(o => (o as any).long === '--format')) {
        cmd.option("--format <type>", "Output format (table|json|csv)", "table");
    }

    cmd.action(async (...args: any[]) => {
        const options = args[args.length - 2];
        const input = { ...options };
        posArgs.forEach((arg, i) => {
            const clean = arg.replace(/[\[\]<>]/g, "");
            if (args[i] !== undefined) input[clean] = args[i];
        });
        try {
            const result = await executor.execute(moduleId, input);
            displayResult(result, options.format);
        } catch (err: any) {
            console.error(chalk.red(`\nError executing ${moduleId}:`), err.message || err);
            process.exit(1);
        }
    });
    return cmd;
}

function getOrAddGroup(parent: Command, name: string, desc: string): Command {
    let group = parent.commands.find(c => c.name() === name);
    if (!group) {
        group = new Command(name).description(desc);
        parent.addCommand(group);
    }
    return group;
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
  
  // Create CLI and STRIP ALL VERSION logic to prevent interception of business --version
  const cli = new Command("aisee");
  (cli as any)._version = undefined;
  (cli as any)._versionOptionName = undefined;
  
  cli.option("-V, --cli-version", "Output CLI version", () => {
    console.log("1.0.0");
    process.exit(0);
  });
  
  cli.option("--format <type>", "Output format (table|json|csv)", "table");

  // Register Tree manually
  registerModule(cli, "scan", scanModule, executor, ["<url>"]);
  registerModule(cli, "report", reportModule, executor, ["<url>", "[section]"]);

  const auth = getOrAddGroup(cli, "auth", "Authentication commands");
  registerModule(auth, "auth.login", loginModule, executor);
  registerModule(auth, "auth.logout", logoutModule, executor);
  registerModule(auth, "auth.whoami", whoamiModule, executor);

  const actions = getOrAddGroup(cli, "actions", "Actionable task commands");
  registerModule(actions, "actions.list", actionsListModule, executor, ["<url>"]);
  registerModule(actions, "actions.suggest", actionsSuggestModule, executor, ["<url>", "<actionId>"]);
  registerModule(actions, "actions.post", actionsPostModule, executor, ["<url>", "<actionId>"]);

  const post = getOrAddGroup(cli, "post", "Social media post commands");
  registerModule(post, "post.create", postCreateModule, executor);
  registerModule(post, "post.list", postListModule, executor);
  registerModule(post, "post.dashboard", postDashboardModule, executor);
  registerModule(post, "post.publish", postPublishModule, executor, ["<id>"]);
  registerModule(post, "post.schedule", postScheduleModule, executor, ["<id>", "<time>"]);

  const channels = getOrAddGroup(cli, "channels", "Integration channels");
  registerModule(channels, "channels.list", channelListModule, executor);
  registerModule(channels, "channels.add", channelAddModule, executor, ["<platform>"]);
  registerModule(channels, "channels.remove", channelRemoveModule, executor, ["<id>"]);

  const conf = getOrAddGroup(cli, "config", "CLI configuration");
  registerModule(conf, "config.list", configListModule, executor);
  registerModule(conf, "config.set", configSetModule, executor);
  registerModule(conf, "config.spec", configSpecModule, executor, ["[service]"]);

  try {
    await cli.parseAsync(process.argv);
  } catch (err: any) {
    if (err.code === "commander.helpDisplayed" || err.code === "commander.version") process.exit(0);
    console.error(chalk.red("Fatal Error:"), err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(chalk.red("Initialization Error:"), err);
  process.exit(1);
});
