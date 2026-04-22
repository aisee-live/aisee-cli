import { z } from "zod";
import { loadSettingsWithSource, saveSettings, Settings } from "../utils/config.ts";
import chalk from "chalk";

export const configListModule = {
  description: "List current configuration and their sources",
  inputSchema: z.object({}),
  async execute() {
    const settings = await loadSettingsWithSource();
    console.log(chalk.bold("\nAISee CLI Configuration:"));
    
    Object.entries(settings).forEach(([key, detail]) => {
      const sourceColor = detail.source === "Config File" ? chalk.green : 
                         detail.source === "Environment Variable" ? chalk.yellow : chalk.gray;
      
      console.log(`${chalk.cyan(key.padEnd(18))}: ${detail.value}`);
      console.log(`${"".padEnd(18)}  ${sourceColor("(Source: " + detail.source + ")")}`);
    });
    
    return { success: true };
  }
};

export const configSetModule = {
  // ... (existing code)
};

export const configSpecModule = {
  description: "View the embedded OpenAPI specifications for internal services",
  inputSchema: z.object({
    service: z.enum(["auth", "analysis", "post-agent"]).describe("Service name to view spec for")
  }),
  async execute(input: any) {
    const { getEmbeddedSpec } = await import("../schemas/index.ts");
    const spec = getEmbeddedSpec(input.service);
    
    console.log(chalk.bold(`\nEmbedded OpenAPI Spec for: ${input.service}`));
    console.log(chalk.gray(`Version: ${spec.info?.version || "Unknown"}`));
    
    return spec;
  }
};
