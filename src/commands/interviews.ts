import { readFile } from "node:fs/promises";
import { Command, Option } from "commander";
import { encodeId, interviewChannels, type InterviewChannel } from "../lib/validation.js";
import { ApiError, apiRequest } from "../lib/api-client.js";
import { printError, printJson } from "../lib/output.js";

type Kind = "demo" | "story_template";
const kindOption = () => new Option("--kind <kind>", "Settings target type").choices(["demo", "story_template"]).default("demo");
const settingsPath = (kind: Kind, id: string) => `/interview-settings/${kind}/${encodeId(id)}`;
async function output(run: () => Promise<unknown>) {
  try { printJson(await run()); }
  catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.body.data) printJson(error.body.data);
    printError(error instanceof ApiError && error.status === 409 ? "Settings changed. Read the latest revision and reconcile your edits before retrying." : error instanceof Error ? error.message : "Request failed");
    process.exitCode = 1;
  }
}
export function createInterviewsCommand(): Command {
  const interviews = new Command("interviews").description("Configure future ElevenLabs interviews without starting a call");
  const settings = interviews.command("settings").description("Edit shared questions, guidance and advanced ElevenLabs settings");
  settings.command("list").addOption(kindOption()).option("--cursor <cursor>", "Continue from nextCursor")
    .option("--limit <count>", "Page size, 1 to 25", Number, 25)
    .action((options: { kind: Kind; cursor?: string; limit: number }) => output(async () => {
      if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 25) throw new Error("limit must be 1 to 25");
      const params = new URLSearchParams({ kind: options.kind, limit: String(options.limit) });
      if (options.cursor) params.set("cursor", options.cursor);
      return (await apiRequest("GET", `/interview-settings?${params}`)).data;
    }));
  settings.command("get").argument("<id>", "ID returned by settings list").addOption(kindOption())
    .description("Read an editable JSON file accepted by settings set")
    .action((id: string, options: { kind: Kind }) => output(async () => {
      const result = await apiRequest<{ revision: number; openingQuestion: string; context: string; instructions: string; elevenLabsSettingsJson: string; interviewChannel?: InterviewChannel | null }>("GET", settingsPath(options.kind, id));
      if (!result.data) throw new Error("Interview settings are unavailable");
      const { revision, openingQuestion, context, instructions, elevenLabsSettingsJson, interviewChannel } = result.data;
      return { expectedRevision: revision, openingQuestion, context, instructions, elevenLabsSettingsJson,
        ...(options.kind === "story_template" ? { interviewChannel } : {}) };
    }));
  settings.command("provider").addOption(kindOption()).requiredOption("--id <id>", "ID returned by settings list")
    .addOption(new Option("--channel <channel>", "Read the saved provider for this channel").choices(["browser_audio", "phone"]).makeOptionMandatory())
    .description("Inspect effective model, voice and turn defaults before editing")
    .action((options: { kind: Kind; id: string; channel: string }) => output(async () =>
      (await apiRequest("GET", `${settingsPath(options.kind, options.id)}/provider?channel=${options.channel}`)).data));
  settings.command("set").argument("<id>", "ID returned by settings list").addOption(kindOption())
    .requiredOption("--file <path>", "Edited JSON from settings get; preserve expectedRevision")
    .description("Save settings for new runs; existing invitations retain their frozen configuration")
    .action((id: string, options: { kind: Kind; file: string }) => output(async () => {
      const body: unknown = JSON.parse(await readFile(options.file, "utf8"));
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Settings file must contain a JSON object");
      const input = body as Record<string, unknown>;
      const fields = ["expectedRevision", "openingQuestion", "context", "instructions", "elevenLabsSettingsJson"];
      if (options.kind === "story_template") fields.push("interviewChannel");
      if (Object.keys(input).some(key => !fields.includes(key)) || !Number.isSafeInteger(input["expectedRevision"]) || Number(input["expectedRevision"]) < 0 ||
          ["openingQuestion", "context", "instructions"].some(key => typeof input[key] !== "string") ||
          (input["elevenLabsSettingsJson"] !== undefined && typeof input["elevenLabsSettingsJson"] !== "string") ||
          (input["interviewChannel"] != null && !interviewChannels.some(channel => channel === input["interviewChannel"])))
        throw new Error("Use the settings get JSON with expectedRevision, openingQuestion, context, instructions and optional elevenLabsSettingsJson. Story templates also accept interviewChannel (phone, browser, browser_audio, browser_video, participant_choice or null).");
      return (await apiRequest("PUT", settingsPath(options.kind, id), input)).data;
    }));
  return interviews;
}
