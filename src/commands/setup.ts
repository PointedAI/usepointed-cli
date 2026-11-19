import { printJson } from "../lib/output.js";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { Command, InvalidArgumentError } from "commander";
import { apiRequest, ApiError } from "../lib/api-client.js";

type JsonObject = Record<string, unknown>;
type MutationOptions = { expectedRevision: number; requestId?: string };

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function revision(value: string) {
  if (!/^\d+$/.test(value))
    throw new InvalidArgumentError(
      "Expected a non-negative integer revision from setup get.",
    );
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new InvalidArgumentError("Revision is too large.");
  return parsed;
}

function taskPath(taskId: string) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(taskId))
    throw new Error(
      "Supply the task ID returned by setup start or setup list.",
    );
  return `/setup/tasks/${encodeURIComponent(taskId)}`;
}

async function boundedFile(path: string) {
  const file = await stat(path);
  if (!file.isFile() || file.size > 256_000)
    throw new Error("Input must be a file smaller than 256 KB.");
  return readFile(path, "utf8");
}

async function jsonFile(path: string): Promise<JsonObject> {
  const parsed = JSON.parse(await boundedFile(path)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("The input file must contain a JSON object.");
  return parsed as JsonObject;
}

function parseInput(value: JsonObject) {
  if (
    Object.keys(value).some(
      (key) => !["objective", "companyUrl", "contactMaterial"].includes(key),
    )
  ) {
    throw new Error(
      "A setup input file accepts only objective, companyUrl, and contactMaterial. Pass request identity through --request-id.",
    );
  }
  if (typeof value.objective !== "string" || !value.objective.trim())
    throw new Error("A non-empty objective is required.");
  for (const field of ["companyUrl", "contactMaterial"]) {
    if (value[field] !== undefined && typeof value[field] !== "string")
      throw new Error(`${field} must be a string.`);
  }
  return value;
}

function printFailure(error: unknown, requestId?: string) {
  const envelope =
    error instanceof ApiError
      ? { ...error.body, status: error.status }
      : {
          error:
            error instanceof Error ? error.message : "Setup request failed",
          meta: { code: "CLI_REQUEST_FAILED", retryable: false },
        };
  console.error(
    JSON.stringify({ ...envelope, ...(requestId ? { requestId } : {}) }),
  );
  process.exitCode = 1;
}

async function read(path: string) {
  try {
    printJson(await apiRequest("GET", path), "json");
  } catch (error) {
    printFailure(error);
  }
}

async function mutate(
  method: "POST" | "PATCH",
  path: string,
  body: JsonObject,
  providedRequestId?: string,
  create = false,
) {
  const requestId = providedRequestId ?? randomUUID();
  if (!UUID.test(requestId))
    throw new Error(
      "--request-id must be a UUID. Reuse the same UUID and arguments after an interrupted request.",
    );
  // Emit before opening the request so even process termination or response
  // loss leaves the caller with the stable identity required for exact replay.
  console.error(
    JSON.stringify({
      requestId,
      message:
        "Reuse this request ID with identical arguments if the response is lost.",
    }),
  );
  try {
    const response = await apiRequest(method, path, {
      ...body,
      [create ? "clientRequestId" : "requestId"]: requestId,
    });
    printJson(response, "json");
  } catch (error) {
    printFailure(error, requestId);
  }
}

function mutationOptions(command: Command) {
  return command
    .requiredOption(
      "--expected-revision <revision>",
      "Exact revision returned by setup get",
      revision,
    )
    .option(
      "--request-id <uuid>",
      "Stable request ID; reuse with identical arguments after a lost response",
    );
}

export function createSetupCommand(): Command {
  const setup = new Command("setup").description(
    "Prepare, review, and apply a durable Pointed setup plan",
  );
  setup
    .command("capabilities")
    .description(
      "Show available setup operations, permissions, and approval requirements",
    )
    .action(async () => {
      await read("/setup/capabilities");
    });
  setup
    .command("list")
    .description("List saved setup tasks in the current workspace")
    .action(async () => {
      await read("/setup/tasks");
    });
  setup
    .command("get")
    .description(
      "Get a setup plan, exact revision and digest, progress, and saved results",
    )
    .argument("<task-id>")
    .action(async (taskId: string) => {
      try {
        await read(taskPath(taskId));
      } catch (error) {
        printFailure(error);
      }
    });

  setup
    .command("start")
    .description(
      "Start from an objective or JSON input file; product changes require a later approval",
    )
    .option("--objective <text>", "What to learn from customer interviews")
    .option("--company-url <url>", "Company website used as planning context")
    .option("--contacts-file <path>", "UTF-8 contact material for the planner")
    .option(
      "--input-file <path>",
      "JSON object with objective, companyUrl, and optional contactMaterial",
    )
    .option(
      "--proposal-file <path>",
      "Complete proposal JSON to review directly, without first-party planning",
    )
    .option(
      "--request-id <uuid>",
      "Stable create request ID; reuse with identical input after a lost response",
    )
    .action(
      async (options: {
        objective?: string;
        companyUrl?: string;
        contactsFile?: string;
        inputFile?: string;
        proposalFile?: string;
        requestId?: string;
      }) => {
        try {
          if (
            options.inputFile &&
            (options.objective || options.companyUrl || options.contactsFile)
          )
            throw new Error(
              "Use --input-file or inline objective options, not both.",
            );
          const input = options.inputFile
            ? parseInput(await jsonFile(options.inputFile))
            : parseInput({
                objective: options.objective,
                ...(options.companyUrl
                  ? { companyUrl: options.companyUrl }
                  : {}),
                ...(options.contactsFile
                  ? { contactMaterial: await boundedFile(options.contactsFile) }
                  : {}),
              });
          const body = options.proposalFile
            ? { ...input, proposal: await jsonFile(options.proposalFile) }
            : input;
          await mutate("POST", "/setup/tasks", body, options.requestId, true);
        } catch (error) {
          printFailure(error);
        }
      },
    );

  mutationOptions(
    setup
      .command("update")
      .description(
        "Replace the editable proposal or brief at an exact task revision",
      )
      .argument("<task-id>")
      .option(
        "--proposal-file <path>",
        "Complete proposal JSON from setup get, including configuration and contacts",
      )
      .option(
        "--input-file <path>",
        "Replacement brief JSON with objective, companyUrl, and contactMaterial",
      ),
  ).action(
    async (
      taskId: string,
      options: MutationOptions & { proposalFile?: string; inputFile?: string },
    ) => {
      try {
        if (Boolean(options.proposalFile) === Boolean(options.inputFile))
          throw new Error(
            "Supply exactly one of --proposal-file or --input-file.",
          );
        const fields = options.proposalFile
          ? { proposal: await jsonFile(options.proposalFile) }
          : { input: parseInput(await jsonFile(options.inputFile!)) };
        await mutate(
          "PATCH",
          taskPath(taskId),
          { expectedRevision: options.expectedRevision, ...fields },
          options.requestId,
        );
      } catch (error) {
        printFailure(error);
      }
    },
  );

  mutationOptions(
    setup
      .command("approve")
      .description(
        "Apply an exact reviewed plan to create the interview and prepare unsent invitations",
      )
      .argument("<task-id>")
      .requiredOption(
        "--plan-digest <digest>",
        "Exact planDigest returned by setup get",
      ),
  ).action(
    async (
      taskId: string,
      options: MutationOptions & { planDigest: string },
    ) => {
      try {
        if (!/^[a-f0-9]{64}$/.test(options.planDigest))
          throw new Error(
            "--plan-digest must be the 64-character digest returned by setup get.",
          );
        await mutate(
          "POST",
          `${taskPath(taskId)}/approve`,
          {
            expectedRevision: options.expectedRevision,
            planDigest: options.planDigest,
          },
          options.requestId,
        );
      } catch (error) {
        printFailure(error);
      }
    },
  );

  for (const action of ["cancel", "retry"] as const) {
    mutationOptions(
      setup
        .command(action)
        .description(
          action === "cancel"
            ? "Cancel remaining work while preserving completed results"
            : "Retry only the remaining work allowed by the saved task state",
        )
        .argument("<task-id>"),
    ).action(async (taskId: string, options: MutationOptions) => {
      try {
        await mutate(
          "POST",
          `${taskPath(taskId)}/${action}`,
          { expectedRevision: options.expectedRevision },
          options.requestId,
        );
      } catch (error) {
        printFailure(error);
      }
    });
  }
  return setup;
}
