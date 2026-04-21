import { z } from "zod";
import { analysisClient } from "../../clients/analysis.ts";

export const scanModule = {
  description: "Scan a website for AEO analysis",
  inputSchema: z.object({
    url: z.string().describe("Website URL to scan"),
    platform: z.string().optional().describe("Specify platforms (comma-separated)"),
    rescan: z.boolean().default(false).describe("Force a re-scan")
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    return await analysisClient.scan(input.url, {
      platform: input.platform,
      rescan: input.rescan
    });
  }
};

export const reportModule = {
  description: "View analysis report",
  inputSchema: z.object({
    url: z.string().describe("Website URL"),
    section: z.string().optional().describe("Specific section to view"),
    version: z.string().optional().describe("Report version"),
    history: z.boolean().default(false).describe("Show report history")
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    if (input.history) {
      // In a real implementation, call a history endpoint
      return { message: "History feature coming soon" };
    }
    return await analysisClient.getReport(input.url, {
      section: input.section,
      version: input.version
    });
  }
};

export const actionsListModule = {
  description: "List tasks/actions for a website",
  inputSchema: z.object({
    url: z.string().describe("Website URL"),
    module: z.string().optional().describe("Filter by module (e.g., strategy, competitor)")
  }),
  async execute(input: any) {
    return await analysisClient.getActions(input.url, input.module);
  }
};

export const actionsSuggestModule = {
  description: "Get AI suggestion for a specific task",
  inputSchema: z.object({
    url: z.string().describe("Website URL"),
    taskId: z.string().describe("Task ID")
  }),
  async execute(input: any) {
    return await analysisClient.getSuggestion(input.url, input.taskId);
  }
};

export const actionsPostModule = {
  description: "Convert a task suggestion into a social media post draft",
  inputSchema: z.object({
    url: z.string().describe("Website URL"),
    taskId: z.string().describe("Task ID"),
    channel: z.string().optional().describe("Target channel ID")
  }),
  async execute(input: any) {
    return await analysisClient.convertToPost(input.url, input.taskId, input.channel);
  }
};
