import { z } from "zod";
import { loadSettingsWithSource, saveSettings } from "../utils/config.ts";
import type { Settings } from "../utils/config.ts";

export const configListModule = {
  description: "List current configuration values and their sources",
  inputSchema: z.object({}),
  async execute() {
    const settings = await loadSettingsWithSource();
    return Object.entries(settings).map(([key, value]) => ({ key, value }));
  },
};

const SETTINGS_KEY_MAP: Record<string, keyof Settings> = {
  auth_api_url: "authApiUrl",
  analysis_api_url: "analysisApiUrl",
  post_agent_api_url: "postAgentApiUrl",
  app_url: "appUrl",
};

export const configSetModule = {
  description: "Update a configuration value",
  inputSchema: z.object({
    key: z
      .enum(["auth_api_url", "analysis_api_url", "post_agent_api_url", "app_url"])
      .describe("Config key to update"),
    value: z.string().describe("New value for the config key"),
  }),
  async execute(input: { key: string; value: string }) {
    const settingsKey = SETTINGS_KEY_MAP[input.key];
    if (!settingsKey) throw new Error(`Unknown config key: ${input.key}`);
    await saveSettings({ [settingsKey]: input.value });
    return { key: input.key, value: input.value, updated: true };
  },
};

export const configSpecModule = {
  description: "View the embedded OpenAPI specification for an internal service",
  inputSchema: z.object({
    service: z
      .enum(["auth", "analysis", "post-agent"])
      .describe("Service name to view spec for"),
  }),
  async execute(input: { service: "auth" | "analysis" | "post-agent" }) {
    const { getEmbeddedSpec } = await import("../schemas/index.ts");
    return getEmbeddedSpec(input.service);
  },
};
