import { Command } from "commander";
import {
  ensureConfigFile,
  getConfigFilePath,
  isConfigKey,
  loadConfig,
  setConfigValue,
  unsetConfigValue,
} from "../lib/config.js";
import { printError, printJson, printSuccess } from "../lib/output.js";

const SUPPORTED_KEYS = ["apiBaseUrl", "defaultFormat", "defaultOrg"] as const;

export function createConfigCommand(): Command {
  const config = new Command("config").description(
    "Manage CLI defaults and preferences",
  );

  config
    .command("get")
    .description("Get a config value or the full config")
    .argument("[key]", `Config key (${SUPPORTED_KEYS.join(", ")})`)
    .action((key?: string) => {
      try {
        const current = ensureConfigFile();

        if (!key) {
          printJson({
            path: getConfigFilePath(),
            config: current,
          });
          return;
        }

        if (!isConfigKey(key)) {
          throw new Error(`Unsupported config key: ${key}`);
        }

        printJson({
          key,
          value: current[key] ?? null,
        });
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  config
    .command("set")
    .description("Set a config value")
    .argument("<key>", `Config key (${SUPPORTED_KEYS.join(", ")})`)
    .argument("<value>", "Config value")
    .action((key: string, value: string) => {
      try {
        if (!isConfigKey(key)) {
          throw new Error(`Unsupported config key: ${key}`);
        }

        const next = setConfigValue(key, value);
        printSuccess(`Updated ${key} in ${getConfigFilePath()}.`);
        printJson({
          key,
          value: next[key] ?? null,
        });
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  config
    .command("unset")
    .description("Reset a config value to its default")
    .argument("<key>", `Config key (${SUPPORTED_KEYS.join(", ")})`)
    .action((key: string) => {
      try {
        if (!isConfigKey(key)) {
          throw new Error(`Unsupported config key: ${key}`);
        }

        const next = unsetConfigValue(key);
        printSuccess(`Reset ${key} in ${getConfigFilePath()}.`);
        printJson({
          key,
          value: next[key] ?? null,
        });
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  config
    .command("path")
    .description("Show the CLI config file path")
    .action(() => {
      try {
        ensureConfigFile();
        printJson({
          path: getConfigFilePath(),
        });
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  config
    .command("list")
    .description("Show the full CLI config")
    .action(() => {
      try {
        const current = loadConfig();
        printJson(current);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  return config;
}
