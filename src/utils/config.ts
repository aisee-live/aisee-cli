import { join } from "path";
import { homedir } from "os";
import { readFile, writeFile, mkdir } from "fs/promises";
import { Config } from "apcore-js";
import { parse, stringify } from "yaml";
import chalk from "chalk";

const CONFIG_DIR = join(homedir(), ".config", "aisee");
const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json");
const SETTINGS_FILE = join(CONFIG_DIR, "config.yaml");

/**
 * Register AISEE namespace to apcore Config bus.
 */
export async function initDefaultConfig() {
  await ensureConfigDir();
  try {
    await readFile(SETTINGS_FILE, "utf-8");
  } catch {
    const defaults = {
      aisee: {
        auth_api_url: "https://api.aisee.live/api/v1",
        analysis_api_url: "https://api.aisee.live/api/v1",
        post_agent_api_url: "https://api.aisee.live/api/v1",
        app_url: "https://aisee.live",
        allow_insecure: false
      },
    };
    await writeFile(SETTINGS_FILE, stringify(defaults));
  }
}

async function ensureConfigDir() {
  await mkdir(CONFIG_DIR, { recursive: true });
}

export interface Credentials {
  userId: string;
  accessToken: string;
  refreshToken: string;
  email: string;
  plan: string;
  credits: number;
}

export interface Settings {
  authApiUrl: string;
  analysisApiUrl: string;
  postAgentApiUrl: string;
  appUrl: string;
  allowInsecure?: boolean;
}

/**
 * Get the current apcore Config instance.
 */
export async function getAppConfig(): Promise<Config> {
  await initDefaultConfig();
  const config = Config.load(SETTINGS_FILE);
  /**
   * Also register apcore executor settings to increase timeouts for long-running CLI tasks like login.
   * Note: apcore-js Config bus allows arbitrary hierarchy; we use 'apcore.executor'
   */
  config.set("apcore.executor.timeout", 60000);
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
    allow_insecure: getValue("allow_insecure"),
  };
}

export async function loadSettings(): Promise<Settings> {
  const detailed = await loadSettingsWithSource();
  return {
    authApiUrl: detailed.auth_api_url,
    analysisApiUrl: detailed.analysis_api_url,
    postAgentApiUrl: detailed.post_agent_api_url,
    appUrl: detailed.app_url,
    allowInsecure: detailed.allow_insecure === true || detailed.allow_insecure === "true",
  };
}

export async function saveSettings(settings: Partial<Settings>) {
  await ensureConfigDir();

  const raw = await readFile(SETTINGS_FILE, "utf-8");
  const data = parse(raw) as Record<string, Record<string, any>>;
  if (!data.aisee) data.aisee = {};

  if (settings.authApiUrl !== undefined) data.aisee.auth_api_url = settings.authApiUrl;
  if (settings.analysisApiUrl !== undefined) data.aisee.analysis_api_url = settings.analysisApiUrl;
  if (settings.postAgentApiUrl !== undefined) data.aisee.post_agent_api_url = settings.postAgentApiUrl;
  if (settings.appUrl !== undefined) data.aisee.app_url = settings.appUrl;
  if (settings.allowInsecure !== undefined) data.aisee.allow_insecure = settings.allowInsecure;

  await writeFile(SETTINGS_FILE, stringify(data));
}

export async function saveCredentials(creds: Credentials) {
  await ensureConfigDir();
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export async function loadCredentials(): Promise<Credentials | null> {
  try {
    const data = await readFile(CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(data) as Partial<Credentials>;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return parsed as Credentials;
  } catch {
    return null;
  }
}

export async function clearCredentials() {
  try {
    await writeFile(CREDENTIALS_FILE, JSON.stringify({}), { mode: 0o600 });
  } catch (error: any) {
    console.warn(`${chalk.yellow("!")} Warning: Failed to clear local credentials: ${error.message}`);
  }
}
