import * as fs from "node:fs";
import { Command } from "commander";
import { ApiError, apiRequest } from "../lib/api-client.js";
import { printJson, printError } from "../lib/output.js";

interface Contact {
  _id: string;
  accountId: string;
  name: string;
  email: string;
  title?: string;
  department?: string;
  createdAt: number;
}

interface BatchContactResult {
  index: number;
  status: "created" | "existing" | "error";
  contact?: Contact;
  message?: string;
  requestedCampaignLink?: {
    campaignId: string;
    campaignTitle: string;
    surveyUrl: string;
  } | null;
  requestedCampaignError?: string | null;
  otherCampaignLinks?: Array<{
    campaignId: string;
    campaignTitle: string;
    surveyUrl: string;
  }>;
  error?: string;
  input?: Record<string, unknown>;
}

interface BatchContactResponse {
  requested: number;
  created: number;
  existing: number;
  failed: number;
  results: BatchContactResult[];
}

interface DuplicateContactResponse {
  duplicate: true;
  message: string;
  contact: Contact;
  requestedCampaignLink: {
    campaignId: string;
    campaignTitle: string;
    surveyUrl: string;
  } | null;
  requestedCampaignError: string | null;
  otherCampaignLinks: Array<{
    campaignId: string;
    campaignTitle: string;
    surveyUrl: string;
  }>;
}

export function createContactsCommand(): Command {
  const contacts = new Command("contacts").description("Manage contacts");

  contacts
    .command("list")
    .description("List contacts for an account")
    .requiredOption("--account-id <id>", "Account ID")
    .action(async (options: { accountId: string }) => {
      try {
        const res = await apiRequest<Contact[]>(
          "GET",
          `/contacts?accountId=${encodeURIComponent(options.accountId)}`,
        );
        printJson(res.data);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  contacts
    .command("get")
    .description("Get a contact by ID")
    .argument("<id>", "Contact ID")
    .action(async (id: string) => {
      try {
        const res = await apiRequest<Contact>("GET", `/contacts/${id}`);
        printJson(res.data);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  contacts
    .command("create")
    .description("Create a new contact")
    .requiredOption("--account-id <id>", "Account ID")
    .requiredOption("--name <name>", "Contact name")
    .requiredOption("--email <email>", "Contact email")
    .option("--campaign-id <id>", "Campaign ID for duplicate-contact link reuse")
    .option("--title <title>", "Job title")
    .option("--department <department>", "Department")
    .action(
      async (options: {
        accountId: string;
        campaignId?: string;
        name: string;
        email: string;
        title?: string;
        department?: string;
      }) => {
        try {
          const res = await apiRequest<Contact>("POST", "/contacts", {
            accountId: options.accountId,
            campaignId: options.campaignId,
            name: options.name,
            email: options.email,
            title: options.title,
            department: options.department,
          });
          printJson(res.data);
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.status === 409 &&
            error.body.data
          ) {
            printError(error.message);
            printJson(error.body.data as DuplicateContactResponse);
            process.exit(1);
          }
          printError(
            error instanceof Error ? error.message : "Request failed",
          );
          process.exit(1);
        }
      },
    );

  contacts
    .command("create-batch")
    .description("Create contacts in batch from a JSON file")
    .requiredOption("--account-id <id>", "Account ID")
    .requiredOption(
      "--input-file <path>",
      "Path to a JSON file containing an array of contacts",
    )
    .option("--campaign-id <id>", "Campaign ID for duplicate-contact link reuse")
    .action(
      async (options: {
        accountId: string;
        campaignId?: string;
        inputFile: string;
      }) => {
        try {
          const raw = fs.readFileSync(options.inputFile, "utf-8");
          const contacts = JSON.parse(raw) as unknown;
          const res = await apiRequest<BatchContactResponse>(
            "POST",
            "/contacts/batch",
            {
              accountId: options.accountId,
              campaignId: options.campaignId,
              contacts,
            },
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

  contacts
    .command("update")
    .description("Update a contact")
    .argument("<id>", "Contact ID")
    .option("--name <name>", "Contact name")
    .option("--email <email>", "Contact email")
    .option("--title <title>", "Job title")
    .option("--department <department>", "Department")
    .action(
      async (
        id: string,
        options: {
          name?: string;
          email?: string;
          title?: string;
          department?: string;
        },
      ) => {
        try {
          const res = await apiRequest<Contact>("PATCH", `/contacts/${id}`, {
            name: options.name,
            email: options.email,
            title: options.title,
            department: options.department,
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

  contacts
    .command("delete")
    .description("Delete a contact that has no survey responses")
    .argument("<id>", "Contact ID")
    .action(async (id: string) => {
      try {
        const res = await apiRequest<{ deleted: boolean }>(
          "DELETE",
          `/contacts/${id}`,
        );
        printJson(res.data);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  return contacts;
}
