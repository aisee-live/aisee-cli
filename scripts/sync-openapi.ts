import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import chalk from "chalk";

const CONFIG_FILE = join(homedir(), ".config", "aisee", "config.yaml");
const OUTPUT_DIR = join(new URL(".", import.meta.url).pathname, "..", "docs", "openapi");

async function sync() {
  console.log(chalk.bold("\n🔄 AISee OpenAPI Sync Tool\n"));

  // 1. Read config.yaml
  let config: any;
  try {
    const content = await readFile(CONFIG_FILE, "utf-8");
    config = parse(content);
  } catch (err) {
    console.error(chalk.red(`❌ Could not read config file at ${CONFIG_FILE}`));
    console.log(chalk.yellow("i Please run the CLI once to generate the default config.\n"));
    process.exit(1);
  }

  const aiseeConfig = config.aisee || {};
  const services = [
    { name: "auth", url: aiseeConfig.auth_api_url },
    { name: "analysis", url: aiseeConfig.analysis_api_url },
    { name: "post-agent", url: aiseeConfig.post_agent_api_url },
  ];

  await mkdir(OUTPUT_DIR, { recursive: true });

  // 2. Fetch and Save
  for (const service of services) {
    if (!service.url) {
      console.log(chalk.gray(`- Skipping ${service.name} (URL not configured)`));
      continue;
    }

    const openApiUrl = `${service.url.replace(/\/$/, "")}/openapi.json`;
    console.log(chalk.cyan(`- Fetching ${service.name} from: `) + chalk.blue(openApiUrl));

    try {
      const response = await fetch(openApiUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      const filePath = join(OUTPUT_DIR, `${service.name}.json`);
      
      await writeFile(filePath, JSON.stringify(data, null, 2));
      console.log(chalk.green(`  ✔ Saved to docs/openapi/${service.name}.json`));
    } catch (err: any) {
      console.error(chalk.red(`  ✘ Failed to fetch ${service.name}: ${err.message}`));
    }
  }

  console.log(chalk.bold("\n✨ Sync completed!\n"));
}

sync();
