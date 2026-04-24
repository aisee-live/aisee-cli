import { z } from "zod";
import { analysisClient } from "../../clients/analysis.ts";
import { loadCredentials } from "../../utils/config.ts";

export const scanModule = {
  description: "Start AEO analysis for a product with complete task orchestration",
  inputSchema: z.object({
    url: z.string().url().describe("Website URL to scan"),
    task_template_id: z.string().optional().describe("Specify a custom task template ID"),
    stream: z.boolean().default(false).describe("Enable streaming output"),
    use_demo: z.boolean().default(false).describe("Use demo mode for testing (no credits consumed)")
  }),
  outputSchema: z.object({
    task_id: z.string(),
    product_id: z.string(),
    status: z.string(),
    created_at: z.string()
  }),
  async execute(input: any) {
    return await analysisClient.scan(input.url, {
      task_template_id: input.task_template_id,
      stream: input.stream,
      use_demo: input.use_demo
    });
  }
};

export const reportModule = {
  description: "Retrieve aggregated analysis reports for a product",
  inputSchema: z.object({
    url: z.string().describe("Website URL associated with the product"),
    section: z.enum(["summary", "ai-presence", "competitor", "strategy", "seo", "mentions"]).optional().default("summary").describe("Specific report section"),
    version: z.string().optional().describe("Fetch a specific historical version"),
    history: z.boolean().optional().describe("List all available historical versions for this URL")
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    const creds = await loadCredentials();
    
    if (input.history) {
      // List history via getPostList (which calls /task)
      return await analysisClient.getPostList({ 
        product_id: input.url,
        user_id: creds?.userId,
        status: "completed"
      });
    }

    return await analysisClient.getReport(input.url, {
      section: input.section,
      version: input.version,
      user_id: creds?.userId
    });
  }
};

export const actionsListModule = {
  description: "List actionable optimization tasks",
  inputSchema: z.object({
    url: z.string().describe("Website URL"),
    page: z.number().int().min(1).default(1),
    size: z.number().int().min(1).max(1000).default(10),
    sort_by: z.string().default("position"),
    sort_order: z.enum(["asc", "desc"]).default("asc"),
    status: z.string().optional().describe("Filter by status (pending, in_progress, completed...)")
  }),
  outputSchema: z.object({
    items: z.array(z.any()),
    total: z.number(),
    page: z.number(),
    size: z.number(),
    pages: z.number()
  }),
  async execute(input: any) {
    return await analysisClient.getActions(input.url, input);
  }
};

export const actionsSuggestModule = {
  description: "Get detailed AI implementation suggestions",
  inputSchema: z.object({
    actionId: z.string().describe("Action ID to generate tasks for"),
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    return await analysisClient.getSuggestion(input.actionId);
  }
};

export const actionsPostModule = {
  description: "Convert a task implementation plan into a social media post draft",
  inputSchema: z.object({
    actionId: z.string().describe("Action ID to convert"),
    channel: z.string().optional()
  }),
  outputSchema: z.any(),
  async execute(input: any) {
    return await analysisClient.convertToPost(input.actionId, input.channel);
  }
};
