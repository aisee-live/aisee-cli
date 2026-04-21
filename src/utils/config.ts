import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { Config } from "apcore-js";

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
    await writeFile(SETTINGS_FILE, SETTINGS_TEMPLATE);
  }
}

/**
 * Get the current apcore Config instance.
 */
export async function getAppConfig(): Promise<Config> {
  await initDefaultConfig();
  return Config.load(SETTINGS_FILE);
}

/**
 * Load and merge configuration using apcore.Config.load.
 */
export async function loadSettingsWithSource(): Promise<any> {
  const config = await getAppConfig();

  const getDetail = (key: string): any => {
    // Priority: config load (handles file + env overrides)
    const value = config.get(`aisee.${key}`);
    return {
      value,
      // Note: apcore Config does not expose the source string directly;
      // this source tag is for UI guidance, logic is managed by apcore.
      source: "apcore Managed"
    };
  };

  return {
    authApiUrl: getDetail("auth_api_url"),
    analysisApiUrl: getDetail("analysis_api_url"),
    postAgentApiUrl: getDetail("post_agent_api_url"),
    appUrl: getDetail("app_url"),
  };
}

export async function loadSettings(): Promise<Settings> {
  const detailed = await loadSettingsWithSource();
  return {
    authApiUrl: detailed.authApiUrl.value,
    analysisApiUrl: detailed.analysisApiUrl.value,
    postAgentApiUrl: detailed.postAgentApiUrl.value,
    appUrl: detailed.appUrl.value,
  };
}

export async function saveSettings(settings: Partial<Settings>) {
  await ensureConfigDir();

  // 1. Load current state via apcore
  const config = Config.load(SETTINGS_FILE);

  // 2. Update in-memory data
  if (settings.authApiUrl) config.set("aisee.auth_api_url", settings.authApiUrl);
  if (settings.analysisApiUrl) config.set("aisee.analysis_api_url", settings.analysisApiUrl);
  if (settings.postAgentApiUrl) config.set("aisee.post_agent_api_url", settings.postAgentApiUrl);
  if (settings.appUrl) config.set("aisee.app_url", settings.appUrl);

  // 3. Write full data back to YAML
  await writeFile(SETTINGS_FILE, stringify(config.data));
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
