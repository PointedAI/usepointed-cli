import { Command } from "commander";
import { apiRequest } from "../lib/api-client.js";
import { printJson, printError } from "../lib/output.js";
import { encodeId, parsePositiveInteger } from "../lib/validation.js";

interface Campaign {
  _id: string;
  accountId: string;
  title: string;
  status: string;
  createdAt: number;
}

export function createCampaignsCommand(): Command {
  const campaigns = new Command("campaigns").description("Manage campaigns");

  campaigns
    .command("list")
    .description("List campaigns in the organization")
    .option("--account-id <id>", "Filter by account ID")
    .action(async (options: { accountId?: string }) => {
      try {
        const query = options.accountId !== undefined
          ? `?accountId=${encodeId(options.accountId)}`
          : "";
        const res = await apiRequest<Campaign[]>("GET", `/campaigns${query}`);
        printJson(res.data);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  campaigns
    .command("get")
    .description("Get a campaign by ID")
    .argument("<id>", "Campaign ID")
    .action(async (id: string) => {
      try {
        const res = await apiRequest<Campaign>("GET", `/campaigns/${encodeId(id)}`);
        printJson(res.data);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  campaigns
    .command("create")
    .description("Create a new campaign")
    .requiredOption("--account-id <id>", "Account ID")
    .requiredOption("--name <name>", "Campaign title")
    .requiredOption("--context <context>", "Campaign context")
    .requiredOption(
      "--initial-question <question>",
      "Initial survey question",
    )
    .option("--description <description>", "Campaign description")
    .option("--max-rounds <rounds>", "Maximum number of rounds", parsePositiveInteger)
    .action(
      async (options: {
        accountId: string;
        name: string;
        context: string;
        initialQuestion: string;
        description?: string;
        maxRounds?: number;
      }) => {
        try {
          const res = await apiRequest<Campaign>("POST", "/campaigns", {
            accountId: options.accountId,
            title: options.name,
            context: options.context,
            initialQuestion: options.initialQuestion,
            description: options.description,
            maxRounds: options.maxRounds,
          });
          printJson(res.data);
        } catch (error) {
          printError(
            error instanceof Error ? error.message : "Request failed",
          );
          process.exit(1);
        }
      },
    );

  campaigns
    .command("update")
    .description("Update an existing campaign")
    .argument("<id>", "Campaign ID")
    .option("--name <name>", "Campaign title")
    .option("--description <description>", "Campaign description")
    .option("--context <context>", "Campaign context")
    .option("--initial-question <question>", "Initial survey question")
    .option("--max-rounds <rounds>", "Maximum number of rounds", parsePositiveInteger)
    .action(
      async (
        id: string,
        options: {
          name?: string;
          description?: string;
          context?: string;
          initialQuestion?: string;
          maxRounds?: number;
        },
      ) => {
        try {
          const res = await apiRequest<Campaign>("PATCH", `/campaigns/${encodeId(id)}`, {
            title: options.name,
            description: options.description,
            context: options.context,
            initialQuestion: options.initialQuestion,
            maxRounds: options.maxRounds,
          });
          printJson(res.data);
        } catch (error) {
          printError(
            error instanceof Error ? error.message : "Request failed",
          );
          process.exit(1);
        }
      },
    );

  return campaigns;
}
