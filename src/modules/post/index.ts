import { z } from "zod";
import { postAgentClient } from "../../clients/post-agent.ts";
import { loadSettings } from "../../utils/config.ts";
import open from "open";

export const postCreateModule = {
  description: "Create a new social media post",
  inputSchema: z.object({
    text: z.string().optional().describe("Content of the post"),
    file: z.string().optional().describe("Load content from a Markdown file"),
    channel: z.string().describe("Channel ID or platform"),
    schedule: z.string().optional().describe("Schedule time (ISO or relative)"),
    image: z.string().optional().describe("Local path to image")
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

    return await postAgentClient.createPost({
      text: content,
      channels: [input.channel],
      schedule: input.schedule,
      media: input.image ? [input.image] : []
    });
  }
};

export const postListModule = {
  description: "List posts",
  inputSchema: z.object({
    status: z.string().optional(),
    channel: z.string().optional(),
    limit: z.number().default(10)
  }),
  async execute(input: any) {
    return await postAgentClient.listPosts(input);
  }
};

export const channelListModule = {
  description: "List connected channels",
  inputSchema: z.object({}),
  async execute() {
    return await postAgentClient.listChannels();
  }
};

export const channelAddModule = {
  description: "Add a new channel via OAuth",
  inputSchema: z.object({
    platform: z.string().describe("Platform name (e.g., x, linkedin)")
  }),
  async execute(input: any) {
    const settings = await loadSettings();
    const url = `${settings.appUrl}/channels/add/${input.platform}`;
    await open(url);
    return { message: `Opening browser to add ${input.platform} channel...` };
  }
};

export const channelRemoveModule = {
  description: "Remove a connected channel",
  inputSchema: z.object({
    id: z.string().describe("Channel ID to remove")
  }),
  async execute(input: any) {
    return await postAgentClient.removeChannel(input.id);
  }
};

export const postDashboardModule = {
  description: "View social media performance dashboard",
  inputSchema: z.object({
    period: z.string().default("7d").describe("Time period (e.g., 24h, 7d, 30d)")
  }),
  async execute(input: any) {
    return await postAgentClient.getDashboard(input.period);
  }
};

export const postPublishModule = {
  description: "Immediately send a post to selected channels",
  inputSchema: z.object({
    id: z.string().describe("Post ID to publish")
  }),
  async execute(input: any) {
    return await postAgentClient.publishPost(input.id);
  }
};

export const postScheduleModule = {
  description: "Schedule a post for a specific future timestamp",
  inputSchema: z.object({
    id: z.string().describe("Post ID to schedule"),
    time: z.string().describe("Schedule time (ISO or relative)")
  }),
  async execute(input: any) {
    return await postAgentClient.schedulePost(input.id, input.time);
  }
};
