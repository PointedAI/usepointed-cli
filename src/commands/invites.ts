import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { apiRequest } from "../lib/api-client.js";
import { printJson, printError } from "../lib/output.js";

type JsonObject = Record<string, unknown>;

interface InviteEmailResult {
  [key: string]: unknown;
}

interface InviteDeliveryIssueResult {
  [key: string]: unknown;
}

function parseJsonObject(value: string, source: string): JsonObject {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${source} must be a JSON object`);
  }

  return parsed as JsonObject;
}

async function readJsonObject(path: string): Promise<JsonObject> {
  return parseJsonObject(await readFile(path, "utf8"), path);
}

async function buildRequestBody(options: {
  data?: string;
  inputFile?: string;
}): Promise<JsonObject> {
  if (options.data && options.inputFile) {
    throw new Error("Pass either --data or --input-file, not both");
  }

  if (options.data) {
    return parseJsonObject(options.data, "--data");
  }

  if (options.inputFile) {
    return readJsonObject(options.inputFile);
  }

  return {};
}

async function runInviteEmailAction(
  id: string,
  action: "preview" | "send-test" | "send" | "remind",
  options: {
    data?: string;
    inputFile?: string;
    email?: string;
  },
): Promise<void> {
  const body = await buildRequestBody(options);
  if (options.email) {
    body["email"] = options.email;
  }

  const res = await apiRequest<InviteEmailResult>(
    "POST",
    `/invites/${id}/email/${action}`,
    body,
  );
  printJson(res.data);
}

export function createInvitesCommand(): Command {
  const invites = new Command("invites").description(
    "Manage invite email delivery flows",
  );

  const email = new Command("email").description("Preview and send invite email");

  email
    .command("preview")
    .description("Preview an invite email")
    .argument("<id>", "Invite ID")
    .option("--data <json>", "JSON request body")
    .option("--input-file <path>", "Path to a JSON request body")
    .action(
      async (
        id: string,
        options: { data?: string; inputFile?: string },
      ) => {
        try {
          await runInviteEmailAction(id, "preview", options);
        } catch (error) {
          printError(
            error instanceof Error ? error.message : "Request failed",
          );
          process.exit(1);
        }
      },
    );

  email
    .command("send-test")
    .description("Send a test invite email")
    .argument("<id>", "Invite ID")
    .option("--email <email>", "Test recipient email")
    .option("--data <json>", "JSON request body")
    .option("--input-file <path>", "Path to a JSON request body")
    .action(
      async (
        id: string,
        options: { email?: string; data?: string; inputFile?: string },
      ) => {
        try {
          await runInviteEmailAction(id, "send-test", options);
        } catch (error) {
          printError(
            error instanceof Error ? error.message : "Request failed",
          );
          process.exit(1);
        }
      },
    );

  email
    .command("send")
    .description("Send an invite email")
    .argument("<id>", "Invite ID")
    .option("--data <json>", "JSON request body")
    .option("--input-file <path>", "Path to a JSON request body")
    .action(
      async (
        id: string,
        options: { data?: string; inputFile?: string },
      ) => {
        try {
          await runInviteEmailAction(id, "send", options);
        } catch (error) {
          printError(
            error instanceof Error ? error.message : "Request failed",
          );
          process.exit(1);
        }
      },
    );

  email
    .command("remind")
    .description("Send an invite reminder email")
    .argument("<id>", "Invite ID")
    .option("--data <json>", "JSON request body")
    .option("--input-file <path>", "Path to a JSON request body")
    .action(
      async (
        id: string,
        options: { data?: string; inputFile?: string },
      ) => {
        try {
          await runInviteEmailAction(id, "remind", options);
        } catch (error) {
          printError(
            error instanceof Error ? error.message : "Request failed",
          );
          process.exit(1);
        }
      },
    );

  invites.addCommand(email);

  const deliveryIssue = new Command("delivery-issue").description(
    "Manage invite delivery issue state",
  );

  deliveryIssue
    .command("clear")
    .description("Clear an invite delivery issue")
    .argument("<id>", "Invite ID")
    .option("--data <json>", "JSON request body")
    .option("--input-file <path>", "Path to a JSON request body")
    .action(
      async (
        id: string,
        options: { data?: string; inputFile?: string },
      ) => {
        try {
          const body = await buildRequestBody(options);
          const res = await apiRequest<InviteDeliveryIssueResult>(
            "POST",
            `/invites/${id}/delivery-issue/clear`,
            body,
          );
          printJson(res.data);
        } catch (error) {
          printError(
            error instanceof Error ? error.message : "Request failed",
          );
          process.exit(1);
        }
      },
    );

  invites.addCommand(deliveryIssue);

  return invites;
}
