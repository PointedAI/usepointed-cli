import { Command } from "commander";
import { apiRequest } from "../lib/api-client.js";
import { printJson, printError } from "../lib/output.js";

interface SurveyLinkResult {
  index: number;
  status: "success" | "error";
  contactId: string;
  contactName?: string;
  contactEmail?: string;
  surveyUrl?: string;
  token?: string;
  error?: string;
}

interface SurveyLinkBatchResponse {
  requested: number;
  succeeded: number;
  failed: number;
  results: SurveyLinkResult[];
}

export function createLinksCommand(): Command {
  const links = new Command("links").description(
    "Generate survey links for contacts",
  );

  links
    .command("generate")
    .description("Generate survey links for a campaign")
    .requiredOption("--campaign-id <id>", "Campaign ID")
    .option(
      "--contact-ids <ids>",
      "Comma-separated contact IDs (omit for all contacts on the account)",
    )
    .option(
      "--contact-emails <emails>",
      "Comma-separated contact emails on the campaign account",
    )
    .action(
      async (options: {
        campaignId: string;
        contactIds?: string;
        contactEmails?: string;
      }) => {
      try {
        if (options.contactIds && options.contactEmails) {
          throw new Error(
            "Pass either --contact-ids or --contact-emails, not both",
          );
        }

        const body: Record<string, unknown> = {
          campaignId: options.campaignId,
        };
        if (options.contactIds) {
          body["contactIds"] = options.contactIds
            .split(",")
            .map((id) => id.trim());
        }
        if (options.contactEmails) {
          body["contactEmails"] = options.contactEmails
            .split(",")
            .map((email) => email.trim());
        }

        const res = await apiRequest<SurveyLinkBatchResponse>(
          "POST",
          `/campaigns/${options.campaignId}/links`,
          body,
        );
        printJson(res.data);
      } catch (error) {
        printError(error instanceof Error ? error.message : "Request failed");
        process.exit(1);
      }
    });

  return links;
}
