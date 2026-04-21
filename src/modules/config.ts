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
  description: "Update a configuration setting",
  inputSchema: z.object({
    key: z.enum(["authApiUrl", "analysisApiUrl", "postAgentApiUrl"]),
    value: z.string().url()
  }),
  async execute(input: any) {
    await saveSettings({ [input.key]: input.value });
    return { message: `Successfully updated ${input.key} to ${input.value}` };
  }
};
