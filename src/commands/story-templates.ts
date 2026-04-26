import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { apiRequest } from "../lib/api-client.js";
import { printJson, printError } from "../lib/output.js";

type JsonObject = Record<string, unknown>;

interface StoryTemplate {
  id?: string;
  _id?: string;
  name?: string;
  title?: string;
  status?: string;
  [key: string]: unknown;
}

interface StoryTemplateEnrollmentOptions {
  [key: string]: unknown;
}

interface StoryTemplateEnrollment {
  [key: string]: unknown;
}

interface LegacyImportSummary {
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

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Expected true or false");
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error("Expected an integer");
  }
  return parsed;
}

export function createStoryTemplatesCommand(): Command {
  const storyTemplates = new Command("story-templates").description(
    "Manage story templates and enrollment flows",
  );

  storyTemplates
    .command("list")
    .description("List story templates")
    .action(async () => {
      try {
        const res = await apiRequest<StoryTemplate[]>("GET", "/story-templates");
        printJson(res.data);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  storyTemplates
    .command("create")
    .description("Create a story template")
    .requiredOption("--title <title>", "Story template title")
    .option("--customer-facing-name <name>", "Name shown to customers")
    .requiredOption("--role <role>", "Target respondent role")
    .requiredOption("--goal <goal>", "Story collection goal")
    .requiredOption("--initial-question <question>", "Opening survey question")
    .option("--description <description>", "Story template description")
    .option("--max-rounds <rounds>", "Maximum survey rounds", parseInteger)
    .action(
      async (options: {
        title: string;
        customerFacingName?: string;
        role: string;
        goal: string;
        initialQuestion: string;
        description?: string;
        maxRounds?: number;
      }) => {
        try {
          const res = await apiRequest<StoryTemplate>("POST", "/story-templates", {
            title: options.title,
            customerFacingName: options.customerFacingName,
            role: options.role,
            goal: options.goal,
            initialQuestion: options.initialQuestion,
            description: options.description,
            maxRounds: options.maxRounds,
          });
          printJson(res.data);
        } catch (error) {
          printError(error instanceof Error ? error.message : "Request failed");
          process.exit(1);
        }
      },
    );

  storyTemplates
    .command("get")
    .description("Get a story template by ID")
    .argument("<id>", "Story template ID")
    .action(async (id: string) => {
      try {
        const res = await apiRequest<StoryTemplate>(
          "GET",
          `/story-templates/${id}`,
        );
        printJson(res.data);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  storyTemplates
    .command("update")
    .description("Update a story template")
    .argument("<id>", "Story template ID")
    .option("--title <title>", "Story template title")
    .option("--customer-facing-name <name>", "Name shown to customers")
    .option("--role <role>", "Target respondent role")
    .option("--goal <goal>", "Story collection goal")
    .option("--initial-question <question>", "Opening survey question")
    .option("--description <description>", "Story template description")
    .option("--max-rounds <rounds>", "Maximum survey rounds", parseInteger)
    .option("--data <json>", "Additional JSON request body")
    .option("--input-file <path>", "Path to a JSON request body")
    .action(
      async (
        id: string,
        options: {
          title?: string;
          customerFacingName?: string;
          role?: string;
          goal?: string;
          initialQuestion?: string;
          description?: string;
          maxRounds?: number;
          data?: string;
          inputFile?: string;
        },
      ) => {
        try {
          const body = await buildRequestBody(options);
          if (options.title !== undefined) body["title"] = options.title;
          if (options.customerFacingName !== undefined) {
            body["customerFacingName"] = options.customerFacingName;
          }
          if (options.role !== undefined) body["role"] = options.role;
          if (options.goal !== undefined) body["goal"] = options.goal;
          if (options.initialQuestion !== undefined) {
            body["initialQuestion"] = options.initialQuestion;
          }
          if (options.description !== undefined) {
            body["description"] = options.description;
          }
          if (options.maxRounds !== undefined) {
            body["maxRounds"] = options.maxRounds;
          }

          const res = await apiRequest<StoryTemplate>(
            "PATCH",
            `/story-templates/${id}`,
            body,
          );
          printJson(res.data);
        } catch (error) {
          printError(error instanceof Error ? error.message : "Request failed");
          process.exit(1);
        }
      },
    );

  storyTemplates
    .command("delete")
    .description("Delete a story template")
    .argument("<id>", "Story template ID")
    .action(async (id: string) => {
      try {
        const res = await apiRequest<{ deleted: boolean }>(
          "DELETE",
          `/story-templates/${id}`,
        );
        printJson(res.data);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  storyTemplates
    .command("enrollment-options")
    .description("Get enrollment options for a story template")
    .argument("<id>", "Story template ID")
    .action(async (id: string) => {
      try {
        const res = await apiRequest<StoryTemplateEnrollmentOptions>(
          "GET",
          `/story-templates/${id}/enrollment-options`,
        );
        printJson(res.data);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  storyTemplates
    .command("enroll")
    .description("Enroll accounts or contacts in a story template")
    .argument("<id>", "Story template ID")
    .option("--account-id <id>", "Account ID")
    .option("--contact-ids <ids>", "Comma-separated contact IDs")
    .option("--contact-emails <emails>", "Comma-separated contact emails")
    .option("--auto-include-new-contacts", "Auto-include newly-created contacts")
    .option("--data <json>", "Additional JSON request body")
    .option("--input-file <path>", "Path to a JSON request body")
    .action(
      async (
        id: string,
        options: {
          accountId?: string;
          contactIds?: string;
          contactEmails?: string;
          autoIncludeNewContacts?: boolean;
          data?: string;
          inputFile?: string;
        },
      ) => {
        try {
          const body = await buildRequestBody(options);
          if (options.accountId) {
            body["accountId"] = options.accountId;
          }
          if (options.contactIds) {
            body["contactIds"] = parseCsv(options.contactIds);
          }
          if (options.contactEmails) {
            body["contactEmails"] = parseCsv(options.contactEmails);
          }
          if (options.autoIncludeNewContacts !== undefined) {
            body["autoIncludeNewContacts"] = options.autoIncludeNewContacts;
          }

          const res = await apiRequest<StoryTemplateEnrollment>(
            "POST",
            `/story-templates/${id}/enroll`,
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

  storyTemplates
    .command("account")
    .description("Get story template state for an account")
    .argument("<id>", "Story template ID")
    .argument("<accountId>", "Account ID")
    .action(async (id: string, accountId: string) => {
      try {
        const res = await apiRequest<StoryTemplateEnrollment>(
          "GET",
          `/story-templates/${id}/accounts/${accountId}`,
        );
        printJson(res.data);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  storyTemplates
    .command("set-auto-include")
    .description("Toggle auto-include for newly-created contacts on an enrolled account")
    .argument("<id>", "Story template ID")
    .argument("<accountId>", "Account ID")
    .requiredOption("--enabled <true|false>", "Whether new contacts are auto-included")
    .action(
      async (
        id: string,
        accountId: string,
        options: { enabled: string },
      ) => {
        try {
          const res = await apiRequest<StoryTemplateEnrollment>(
            "PATCH",
            `/story-templates/${id}/accounts/${accountId}`,
            {
              autoIncludeNewContacts: parseBoolean(options.enabled),
            },
          );
          printJson(res.data);
        } catch (error) {
          printError(error instanceof Error ? error.message : "Request failed");
          process.exit(1);
        }
      },
    );

  storyTemplates
    .command("legacy-import-summary")
    .description("Get a summary for importing legacy story templates")
    .action(async () => {
      try {
        const res = await apiRequest<LegacyImportSummary>(
          "GET",
          "/story-templates/legacy-import-summary",
        );
        printJson(res.data);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  storyTemplates
    .command("import-legacy")
    .description("Import legacy story templates")
    .action(async () => {
      try {
        const res = await apiRequest<LegacyImportSummary>(
          "POST",
          "/story-templates/import-legacy",
          {},
        );
        printJson(res.data);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  return storyTemplates;
}
