import { Command } from "commander";
import { apiRequest } from "../lib/api-client.js";
import { printJson, printError } from "../lib/output.js";

interface Account {
  _id: string;
  name: string;
  industry?: string;
  contractValue?: number;
  renewalDate?: number;
  notes?: string;
  createdAt: number;
}

export function createAccountsCommand(): Command {
  const accounts = new Command("accounts").description("Manage accounts");

  accounts
    .command("list")
    .description("List all accounts in the organization")
    .action(async () => {
      try {
        const res = await apiRequest<Account[]>("GET", "/accounts");
        printJson(res.data);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  accounts
    .command("get")
    .description("Get an account by ID")
    .argument("<id>", "Account ID")
    .action(async (id: string) => {
      try {
        const res = await apiRequest<Account>("GET", `/accounts/${id}`);
        printJson(res.data);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  accounts
    .command("create")
    .description("Create a new account")
    .requiredOption("--name <name>", "Account name")
    .option("--industry <industry>", "Industry")
    .option("--contract-value <value>", "Contract value", parseFloat)
    .option("--notes <notes>", "Notes")
    .action(
      async (options: {
        name: string;
        industry?: string;
        contractValue?: number;
        notes?: string;
      }) => {
        try {
          const res = await apiRequest<Account>("POST", "/accounts", {
            name: options.name,
            industry: options.industry,
            contractValue: options.contractValue,
            notes: options.notes,
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

  return accounts;
}
