import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { Config } from "apcore-js";
import chalk from "chalk";

export interface Credentials {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  plan: string;
  credits: number;
}

export interface Settings {
  authApiUrl: string;
  analysisApiUrl: string;
  postAgentApiUrl: string;
  appUrl: string;
}

const CONFIG_DIR = join(homedir(), ".config", "aisee");
const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json");
const SETTINGS_FILE = join(CONFIG_DIR, "config.yaml");

/**
 * Register AISEE namespace to apcore Config bus.
 */
Config.registerNamespace({
  name: "aisee",
  envPrefix: "AISEE",
  defaults: {
    auth_api_url: "https://api-auth.aisee.live",
    analysis_api_url: "https://api.aisee.live",
    post_agent_api_url: "https://api-post.aisee.live",
    app_url: "https://app.aisee.live"
  }
});

/**
 * Also register apcore executor settings to increase timeouts for long-running CLI tasks like login.
 */
Config.registerNamespace({
  name: "executor",
  defaults: {
    default_timeout: 300000, // 5 minutes
    global_timeout: 600000   // 10 minutes
  }
});

const SETTINGS_TEMPLATE = `# AISee CLI Configuration
# This file is managed by apcore configuration bus.

# Global apcore settings
apcore:
  version: 1.0

# Executor settings (Timeouts in milliseconds)
executor:
  default_timeout: 300000
  global_timeout: 600000

# AISee Business Settings
aisee:
  auth_api_url: https://api-auth.aisee.live
  analysis_api_url: https://api.aisee.live
  post_agent_api_url: https://api-post.aisee.live
  app_url: https://app.aisee.live
`;

async function ensureConfigDir() {
  await mkdir(CONFIG_DIR, { recursive: true });
}

export async function initDefaultConfig() {
  await ensureConfigDir();
  try {
    await access(SETTINGS_FILE);
  } catch {
    // File doesn't exist, create it from template
    await writeFile(SETTINGS_FILE, SETTINGS_TEMPLATE);
    console.log(`\n${chalk.yellow("i")} Created default configuration at ${chalk.blue(SETTINGS_FILE)}`);
    console.log(`${chalk.yellow("i")} Edit this file if you need to point to a local development server.\n`);
  }
}

/**
 * Get the current apcore Config instance.
 */
export async function getAppConfig(): Promise<Config> {
  await initDefaultConfig();
  const config = Config.load(SETTINGS_FILE);
  if (!config) {
    throw new Error(`Failed to load configuration from ${SETTINGS_FILE}`);
  }
  return config;
}

/**
 * Load and merge configuration using apcore.Config.load.
 */
export async function loadSettingsWithSource(): Promise<any> {
  const config = await getAppConfig();

  const getValue = (key: string) => config.get(`aisee.${key}`);

  return {
    auth_api_url: getValue("auth_api_url"),
    analysis_api_url: getValue("analysis_api_url"),
    post_agent_api_url: getValue("post_agent_api_url"),
    app_url: getValue("app_url"),
  };
}

export async function loadSettings(): Promise<Settings> {
  const detailed = await loadSettingsWithSource();
  return {
    authApiUrl: detailed.auth_api_url,
    analysisApiUrl: detailed.analysis_api_url,
    postAgentApiUrl: detailed.post_agent_api_url,
    appUrl: detailed.app_url,
  };
}

export async function saveSettings(settings: Partial<Settings>) {
  await ensureConfigDir();

  const raw = await readFile(SETTINGS_FILE, "utf-8");
  const data = parse(raw) as Record<string, Record<string, string>>;
  if (!data.aisee) data.aisee = {};

  if (settings.authApiUrl !== undefined) data.aisee.auth_api_url = settings.authApiUrl;
  if (settings.analysisApiUrl !== undefined) data.aisee.analysis_api_url = settings.analysisApiUrl;
  if (settings.postAgentApiUrl !== undefined) data.aisee.post_agent_api_url = settings.postAgentApiUrl;
  if (settings.appUrl !== undefined) data.aisee.app_url = settings.appUrl;

  await writeFile(SETTINGS_FILE, stringify(data));
}

export async function saveCredentials(creds: Credentials) {
  await ensureConfigDir();
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
}

export async function loadCredentials(): Promise<Credentials | null> {
  try {
    const data = await readFile(CREDENTIALS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function clearCredentials() {
  try {
    await writeFile(CREDENTIALS_FILE, JSON.stringify({}));
  } catch { }
}
