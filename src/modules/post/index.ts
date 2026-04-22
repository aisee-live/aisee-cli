import { z } from "zod";
import { postAgentClient } from "../../clients/post-agent.ts";
import open from "open";

export const postCreateModule = {
  description: "Create and prepare a new social media post for one or more channels",
  inputSchema: z.object({
    text: z.string().optional().describe("Direct text content of the post"),
    file: z.string().optional().describe("Path to a local Markdown file to use as post content"),
    channel: z.string().describe("Channel ID or platform identifier (e.g., 'x', 'linkedin')"),
    schedule: z.string().optional().describe("Desired publication time (ISO 8601 format)"),
    image: z.string().optional().describe("Local path to an image file to attach as media")
  }),
  outputSchema: z.object({
    id: z.string().describe("Unique identifier of the created post"),
    status: z.string().describe("Initial workflow status"),
    channels: z.array(z.string()).optional().describe("Targeted channel IDs")
  }),
  async execute(input: any) {
    let content = input.text;
    
    if (input.file) {
      const { readFile } = await import("node:fs/promises");
      content = await readFile(input.file, "utf-8");
    }

    if (!content) {
      throw new Error("Either 'text' or 'file' must be provided.");
    }

    // According to postiz-app controller, it maps raw body to post type
    return await postAgentClient.createPost({
      text: content,
      channels: [input.channel],
      schedule: input.schedule,
      media: input.image ? [input.image] : []
    });
  }
};

export const postListModule = {
  description: "Retrieve a list of social media posts with filtering",
  inputSchema: z.object({
    startDate: z.string().optional().describe("Start date for filtering (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("End date for filtering (YYYY-MM-DD)"),
    state: z.enum(["DRAFT", "QUEUE", "PUBLISHED", "ERROR"]).optional().describe("Filter posts by their current state"),
    channel: z.string().optional().describe("Filter posts by channel ID"),
    limit: z.number().int().min(1).max(100).default(10).describe("Number of items per page")
  }),
  outputSchema: z.object({
    items: z.array(z.any()).describe("List of post records"),
    total: z.number().describe("Total count matching filters")
  }),
  async execute(input: any) {
    // Set default dates if not provided (default to last 30 days)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    const params = {
      startDate: input.startDate || thirtyDaysAgo.toISOString().split('T')[0],
      endDate: input.endDate || now.toISOString().split('T')[0],
      state: input.state,
      channel: input.channel,
      limit: input.limit
    };

    return await postAgentClient.listPosts(params);
  }
};

export const channelListModule = {
  description: "List all connected social media channels and their status",
  inputSchema: z.object({}),
  outputSchema: z.array(z.object({
    id: z.string().describe("Unique integration identifier"),
    platform: z.string().describe("Platform name (x, reddit, linkedin, facebook, etc.)"),
    name: z.string().describe("Display name or username"),
    connected: z.boolean().describe("Whether the connection is healthy")
  })),
  async execute() {
    return await postAgentClient.listChannels();
  }
};

export const channelAddModule = {
  description: "Connect a new social media account via OAuth",
  inputSchema: z.object({
    platform: z.enum([
      "x", "reddit", "linkedin", "linkedin-page", "instagram", 
      "facebook", "youtube", "tiktok", "pinterest", "threads",
      "mastodon", "bluesky", "medium", "devto", "hashnode"
    ]).describe("Social platform to connect")
  }),
  outputSchema: z.object({
    message: z.string()
  }),
  async execute(input: any) {
    // Redirects to the hosted OAuth flow
    const url = `https://app.aisee.ai/channels/add/${input.platform}`;
    await open(url);
    return { message: `Opening browser to authorize ${input.platform} connection...` };
  }
};

export const channelRemoveModule = {
  description: "Disconnect and remove a social media channel",
  inputSchema: z.object({
    id: z.string().describe("The integration ID to remove")
  }),
  outputSchema: z.object({
    success: z.boolean()
  }),
  async execute(input: any) {
    return await postAgentClient.removeChannel(input.id);
  }
};

export const postDashboardModule = {
  description: "View social media engagement and traffic summary",
  inputSchema: z.object({
    period: z.enum(["24h", "7d", "30d", "90d"]).default("7d").describe("Time range for metrics"),
    channel: z.string().optional().describe("Filter metrics by platform name")
  }),
  outputSchema: z.object({
    summary: z.object({
      total_posts: z.number(),
      engagement_rate: z.number(),
      impressions: z.number()
    }).optional(),
    trend: z.array(z.any()).optional()
  }),
  async execute(input: any) {
    return await postAgentClient.getDashboard(input.period);
  }
};

export const postPublishModule = {
  description: "Publish a prepared post immediately",
  inputSchema: z.object({
    id: z.string().describe("Internal ID of the post to publish")
  }),
  outputSchema: z.object({
    status: z.string(),
    published_at: z.string().optional()
  }),
  async execute(input: any) {
    return await postAgentClient.publishPost(input.id);
  }
};

export const postScheduleModule = {
  description: "Update the scheduled time for a post",
  inputSchema: z.object({
    id: z.string().describe("Post ID"),
    time: z.string().describe("New target time (ISO 8601)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    scheduled_at: z.string()
  }),
  async execute(input: any) {
    return await postAgentClient.schedulePost(input.id, input.time);
  }
};
