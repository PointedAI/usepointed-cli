import { Command } from "commander";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { apiRequest } from "../lib/api-client.js";
import { printJson, printError } from "../lib/output.js";
import { startSpinner } from "../lib/spinner.js";

type JsonObject = Record<string, unknown>;

interface SmartIntakePreviewRow {
  rowIndex: number;
  accountName: string;
  contactName: string;
  contactEmail: string;
  status: string;
  [key: string]: unknown;
}

interface SmartIntakePreview {
  sessionId: string;
  rows: SmartIntakePreviewRow[];
  [key: string]: unknown;
}

interface SmartIntakeCommitResult {
  summary: JsonObject;
  [key: string]: unknown;
}

function parseJsonArray(value: string, source: string): JsonObject[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${source} must be a JSON array`);
  }
  return parsed as JsonObject[];
}

async function readJsonArray(path: string): Promise<JsonObject[]> {
  return parseJsonArray(await readFile(path, "utf8"), path);
}

export function createSmartIntakeCommand(): Command {
  const smartIntake = new Command("smart-intake").description(
    "AI-powered bulk account and contact intake",
  );

  smartIntake
    .command("preview")
    .description("Preview a smart intake from raw text input")
    .requiredOption("--raw-input <text>", "Raw text input (CSV, pasted list, etc.)")
    .option("--story-template-id <id>", "Story template to enroll created accounts into")
    .option("--idempotency-key <key>", "Idempotency key (auto-generated if omitted)")
    .action(
      async (options: {
        rawInput: string;
        storyTemplateId?: string;
        idempotencyKey?: string;
      }) => {
        const spinner = startSpinner("Processing intake preview…");
        try {
          const res = await apiRequest<SmartIntakePreview>(
            "POST",
            "/smart-intake/preview",
            {
              rawInput: options.rawInput,
              storyTemplateId: options.storyTemplateId,
              idempotencyKey: options.idempotencyKey ?? randomUUID(),
            },
          );
          spinner.stop();
          printJson(res.data);
        } catch (error) {
          spinner.stop();
          printError(
            error instanceof Error ? error.message : "Request failed",
          );
          process.exit(1);
        }
      },
    );

  smartIntake
    .command("commit")
    .description("Commit a previewed smart intake session")
    .requiredOption("--session-id <id>", "Session ID from a preview result")
    .option(
      "--resolutions <json>",
      "JSON array of row resolutions",
    )
    .option(
      "--input-file <path>",
      "Path to a JSON file containing row resolutions",
    )
    .action(
      async (options: {
        sessionId: string;
        resolutions?: string;
        inputFile?: string;
      }) => {
        try {
          if (options.resolutions && options.inputFile) {
            throw new Error("Pass either --resolutions or --input-file, not both");
          }

          let resolutions: JsonObject[];
          if (options.resolutions) {
            resolutions = parseJsonArray(options.resolutions, "--resolutions");
          } else if (options.inputFile) {
            resolutions = await readJsonArray(options.inputFile);
          } else {
            throw new Error("Either --resolutions or --input-file is required");
          }

          const spinner = startSpinner("Committing intake session…");
          const res = await apiRequest<SmartIntakeCommitResult>(
            "POST",
            "/smart-intake/commit",
            {
              sessionId: options.sessionId,
              resolutions,
            },
          );
          spinner.stop();
          printJson(res.data);
        } catch (error) {
          printError(
            error instanceof Error ? error.message : "Request failed",
          );
          process.exit(1);
        }
      },
    );

  return smartIntake;
}
