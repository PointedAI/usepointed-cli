import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface PointedConfig {
  apiBaseUrl: string;
  defaultFormat: "json" | "table";
  defaultOrg?: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".pointed");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: PointedConfig = {
  apiBaseUrl: "https://app.usepointed.ai",
  defaultFormat: "json",
};

export type ConfigKey = keyof PointedConfig;
const CONFIG_KEYS: ConfigKey[] = ["apiBaseUrl", "defaultFormat", "defaultOrg"];

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadConfig(): PointedConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Partial<PointedConfig>;
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch {
    // Fall through to defaults
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(config: PointedConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

export function ensureConfigFile(): PointedConfig {
  const config = loadConfig();
  if (!fs.existsSync(CONFIG_FILE)) {
    saveConfig(config);
  }
  return config;
}

export function getConfigFilePath(): string {
  return CONFIG_FILE;
}

export function isConfigKey(value: string): value is ConfigKey {
  return CONFIG_KEYS.includes(value as ConfigKey);
}

export function setConfigValue(key: ConfigKey, rawValue: string): PointedConfig {
  const config = loadConfig();

  switch (key) {
    case "apiBaseUrl": {
      const value = rawValue.trim().replace(/\/$/, "");
      if (!value) {
        throw new Error("apiBaseUrl cannot be empty");
      }
      config.apiBaseUrl = value;
      break;
    }
    case "defaultFormat": {
      if (rawValue !== "json" && rawValue !== "table") {
        throw new Error("defaultFormat must be one of: json, table");
      }
      config.defaultFormat = rawValue;
      break;
    }
    case "defaultOrg": {
      const value = rawValue.trim();
      config.defaultOrg = value || undefined;
      break;
    }
  }

  saveConfig(config);
  return config;
}

export function unsetConfigValue(key: ConfigKey): PointedConfig {
  const config = loadConfig();

  switch (key) {
    case "apiBaseUrl":
      config.apiBaseUrl = DEFAULT_CONFIG.apiBaseUrl;
      break;
    case "defaultFormat":
      config.defaultFormat = DEFAULT_CONFIG.defaultFormat;
      break;
    case "defaultOrg":
      delete config.defaultOrg;
      break;
  }

  saveConfig(config);
  return config;
}

export function getApiBaseUrl(): string {
  const envUrl = process.env["POINTED_API_URL"];
  if (envUrl) return envUrl.replace(/\/$/, "");
  return loadConfig().apiBaseUrl.replace(/\/$/, "");
}

export function getOutputFormat(): PointedConfig["defaultFormat"] {
  const envFormat = process.env["POINTED_OUTPUT_FORMAT"];
  if (envFormat === "json" || envFormat === "table") {
    return envFormat;
  }
  return loadConfig().defaultFormat;
}
