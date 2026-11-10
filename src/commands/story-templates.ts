import { Command, Option } from "commander";
import { readFile } from "node:fs/promises";
import { apiRequest } from "../lib/api-client.js";
import { printJson, printError } from "../lib/output.js";
import {
  encodeId,
  parseContactSelector,
  parsePositiveInteger,
} from "../lib/validation.js";

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

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Expected true or false");
}

export function createStoryTemplatesCommand(): Command {
  const storyTemplates = new Command("story-templates").description(
    "Manage interview templates and enrollment flows",
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
    .command("starters")
    .description("List the use-case starters (ROI stories, win/loss, ...) for `create --starter`")
    .action(async () => {
      try {
        printJson((await apiRequest<unknown[]>("GET", "/story-templates/starters")).data);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  storyTemplates
    .command("create")
    .description(
      "Create an interview template. Start from a use case with --starter (see `starters`), " +
        "or give --title and --goal yourself; options you pass override the starter's.",
    )
    .option("--starter <id>", "Use-case starter, e.g. roi-stories")
    .option("--title <title>", "Interview template title")
    .option("--goal <goal>", "What the interview should learn")
    .option("--product-name <name>", "The product the interview is about (used in the opening)")
    .option("--product <name>", "Same as --product-name")
    .option("--customer-facing-name <name>", "Name shown to customers")
    .option("--role <role>", "Target respondent role (default: Account stakeholder)")
    .option("--initial-question <question>", "Opening interview question")
    .option("--description <description>", "Interview template description")
    .option("--max-rounds <rounds>", "Maximum interview rounds", parsePositiveInteger)
    .addOption(new Option("--interview-channel <channel>", "Participant interview type").choices(["phone", "browser_audio"]))
    .addOption(new Option("--interview-length <length>", "Interview length: quick (2–3 min), standard (4–6), deep (7–10)").choices(["quick", "standard", "deep"]))
    .action(
      async (options: {
        starter?: string;
        title?: string;
        goal?: string;
        customerFacingName?: string;
        productName?: string;
        product?: string;
        role?: string;
        initialQuestion?: string;
        description?: string;
        maxRounds?: number;
        interviewChannel?: "phone" | "browser_audio";
        interviewLength?: "quick" | "standard" | "deep";
      }) => {
        try {
          if (!options.starter && (!options.title || !options.goal)) {
            throw new Error("Pass --starter <id>, or both --title and --goal. See `pointed story-templates starters`.");
          }
          const res = await apiRequest<StoryTemplate>("POST", "/story-templates", {
            starter: options.starter,
            title: options.title,
            customerFacingName: options.customerFacingName,
            productName: options.productName ?? options.product,
            role: options.role,
            goal: options.goal,
            initialQuestion: options.initialQuestion,
            description: options.description,
            maxRounds: options.maxRounds,
            interviewChannel: options.interviewChannel,
            interviewLength: options.interviewLength,
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
          `/story-templates/${encodeId(id)}`,
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
    .option("--max-rounds <rounds>", "Maximum survey rounds", parsePositiveInteger)
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
            `/story-templates/${encodeId(id)}`,
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
          `/story-templates/${encodeId(id)}`,
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
          `/story-templates/${encodeId(id)}/enrollment-options`,
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
    .option("--account-ids <ids>", "Comma-separated account IDs: enroll everyone at each")
    .option("--all-accounts", "Enroll everyone at every account in the workspace")
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
          accountIds?: string;
          allAccounts?: boolean;
          contactIds?: string;
          contactEmails?: string;
          autoIncludeNewContacts?: boolean;
          data?: string;
          inputFile?: string;
        },
      ) => {
        try {
          const body = await buildRequestBody(options);
          const templateId = encodeId(id);
          if (options.allAccounts && options.accountIds !== undefined) {
            throw new Error("Choose either --all-accounts or --account-ids, not both.");
          }
          if (options.allAccounts || options.accountIds !== undefined) {
            if (options.accountId !== undefined || options.contactIds !== undefined || options.contactEmails !== undefined ||
              ["accountId", "contactIds", "contactEmails", "selections"].some(key => body[key] !== undefined)) {
              throw new Error("Whole-account flags cannot be combined with account/contact selectors or JSON selections.");
            }
            const many = options.allAccounts
              ? ((await apiRequest<{ _id: string }[]>("GET", "/accounts")).data ?? []).map(account => encodeId(account._id))
              : parseContactSelector(options.accountIds!, "--account-ids").map(encodeId);
            if (!many.length) throw new Error("No accounts to enroll");
            body["selections"] = many.map(accountId => ({ accountId,
              ...(options.autoIncludeNewContacts !== undefined ? { autoIncludeNewContacts: options.autoIncludeNewContacts } : {}),
            }));
          }
          if (options.accountId !== undefined) {
            body["accountId"] = encodeId(options.accountId);
          }
          if (options.contactIds !== undefined) {
            body["contactIds"] = parseContactSelector(
              options.contactIds,
              "--contact-ids",
            );
          }
          if (options.contactEmails !== undefined) {
            body["contactEmails"] = parseContactSelector(
              options.contactEmails,
              "--contact-emails",
            );
          }
          if (options.autoIncludeNewContacts !== undefined) {
            body["autoIncludeNewContacts"] = options.autoIncludeNewContacts;
          }
          if (
            body["contactIds"] !== undefined &&
            body["contactEmails"] !== undefined
          ) {
            throw new Error(
              "Pass either contact IDs or contact emails, not both",
            );
          }

          const res = await apiRequest<StoryTemplateEnrollment>(
            "POST",
            `/story-templates/${templateId}/enroll`,
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
          `/story-templates/${encodeId(id)}/accounts/${encodeId(accountId)}`,
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
            `/story-templates/${encodeId(id)}/accounts/${encodeId(accountId)}`,
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
