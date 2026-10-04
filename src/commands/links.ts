import { Command } from "commander";
import { apiRequest } from "../lib/api-client.js";
import { printJson, printError } from "../lib/output.js";
import { encodeId, parseContactSelector } from "../lib/validation.js";

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
          if (
            options.contactIds !== undefined &&
            options.contactEmails !== undefined
          ) {
            throw new Error(
              "Pass either --contact-ids or --contact-emails, not both",
            );
          }

          const body: Record<string, unknown> = {
            campaignId: options.campaignId,
          };
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

          const res = await apiRequest<SurveyLinkBatchResponse>(
            "POST",
            `/campaigns/${encodeId(options.campaignId)}/links`,
            body,
          );
          printJson(res.data);
          if ((res.data?.failed ?? 0) > 0) {
            process.exitCode = 1;
          }
        } catch (error) {
          printError(error instanceof Error ? error.message : "Request failed");
          process.exit(1);
        }
      },
    );

  return links;
}
