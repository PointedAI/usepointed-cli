import { readFile } from "node:fs/promises";
import { Command, Option } from "commander";
import { ApiError, apiRequest } from "../lib/api-client.js";
import { encodeId } from "../lib/validation.js";
import { printJson, printError } from "../lib/output.js";

async function output(run: () => Promise<unknown>) {
  try { printJson(await run()); }
  catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.body.data) printJson(error.body.data);
    printError(error instanceof ApiError && error.status === 409 ? "Settings changed. Read the latest revision and reconcile your edits before retrying." : error instanceof Error ? error.message : "Request failed");
    process.exitCode = 1;
  }
}
export function createAdminCommand(): Command {
  const admin = new Command("admin").description("Platform-admin operations (pointed auth login --admin required)");
  const demos = admin.command("demos").description("Find founder demos and configure native ElevenLabs interviews");
  demos.command("list").action(() => output(async () => (await apiRequest("GET", "/admin/demos?kind=founder")).data));
  demos.command("get").argument("<id>").action((id: string) => output(async () =>
    (await apiRequest("GET", `/admin/demos/${encodeId(id)}?kind=founder`)).data));
  const settings = demos.command("voice-settings").description("Configure browser voice or phone settings without starting a call");
  settings.command("get").argument("<id>")
    .addOption(new Option("--channel <channel>", "Native ElevenLabs channel").choices(["browser_audio", "phone"]).makeOptionMandatory())
    .description("Export the current revision and editable native ElevenLabs configuration")
    .action((id: string, options: { channel: string }) => output(async () =>
      (await apiRequest("GET", `/admin/demos/${encodeId(id)}/voice-settings?kind=founder&channel=${options.channel}`)).data));
  settings.command("set").argument("<id>").requiredOption("--file <path>", "Edited JSON from voice-settings get")
    .action((id: string, options: { file: string }) => output(async () => {
      const target = encodeId(id);
      const value: unknown = JSON.parse(await readFile(options.file, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Settings file must contain a JSON object");
      const input = value as Record<string, unknown>;
      if (Object.keys(input).some(key => !["channel", "expectedRevision", "configuration"].includes(key)) ||
          !["browser_audio", "phone"].includes(String(input["channel"])) ||
          !Number.isSafeInteger(input["expectedRevision"]) || Number(input["expectedRevision"]) < 0 ||
          !input["configuration"] || typeof input["configuration"] !== "object" || Array.isArray(input["configuration"]))
        throw new Error("Use the voice-settings get JSON with channel, expectedRevision and configuration");
      return (await apiRequest("PUT", `/admin/demos/${target}/voice-settings?kind=founder`, input)).data;
    }));
  return admin;
}
