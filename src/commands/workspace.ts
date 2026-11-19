import { printJson } from "../lib/output.js";
import { randomUUID } from "node:crypto";
import { Command } from "commander";
import { apiRequest, ApiError } from "../lib/api-client.js";

function printFailure(error: unknown, requestId?: string) {
  const body = error instanceof ApiError ? error.body : undefined;
  console.error(
    JSON.stringify({
      ...(body ?? {
        error:
          error instanceof Error ? error.message : "Workspace request failed",
      }),
      ...(requestId ? { requestId } : {}),
    }),
  );
  process.exitCode = 1;
}

export function createWorkspaceCommand(): Command {
  const workspace = new Command("workspace").description(
    "Inspect and complete authenticated workspace setup",
  );
  workspace
    .command("status")
    .description(
      "Show workspace access, missing setup, and a resumable request ID",
    )
    .action(async () => {
      try {
        printJson(await apiRequest("GET", "/workspace/status"), "json");
      } catch (error) {
        printFailure(error);
      }
    });
  workspace
    .command("bootstrap")
    .description(
      "Create your first workspace or select a workspace you already belong to",
    )
    .option("--name <name>", "Name for a new workspace")
    .option(
      "--clerk-org-id <id>",
      "Select an existing authorized Clerk organization",
    )
    .option(
      "--request-id <uuid>",
      "Stable setup request ID; reuse for every retry",
    )
    .action(
      async (options: {
        name?: string;
        clerkOrgId?: string;
        requestId?: string;
      }) => {
        const requestId = options.requestId ?? randomUUID();
        try {
          if (Boolean(options.name) === Boolean(options.clerkOrgId))
            throw new Error("Supply exactly one of --name or --clerk-org-id.");
          const result = await apiRequest("POST", "/workspace/bootstrap", {
            requestId,
            ...(options.name
              ? { name: options.name }
              : { clerkOrgId: options.clerkOrgId }),
          });
          printJson(result, "json");
        } catch (error) {
          printFailure(error, requestId);
        }
      },
    );
  return workspace;
}
