import { printJson, printError } from "../lib/output.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { apiRequest } from "../lib/api-client.js";
async function read(params: Record<string, string> = {}) {
  try {
    printJson(await apiRequest("GET", "/agent", undefined, params), "json");
  } catch (error) {
    printError(error instanceof Error ? error.message : "Agent request failed");
    process.exitCode = 1;
  }
}
async function write(body: Record<string, unknown>, requestId = randomUUID()) {
  console.error(JSON.stringify({ requestId }));
  try {
    printJson(await apiRequest("POST", "/agent", { ...body, requestId }), "json");
  } catch (error) {
    printError(error instanceof Error ? error.message : "Agent request failed");
    process.exitCode = 1;
  }
}
export function createAgentCommand() {
  const command = new Command("agent").description(
    "Use Pointed's shared workspace agent and product capabilities",
  );
  command.command("list").action(() => read());
  command.command("get <sessionId>").action((sessionId) => read({ sessionId }));
  command
    .command("capabilities")
    .option("--search <search>")
    .action((options) =>
      read({ catalog: "true", search: options.search ?? "" }),
    );
  command
    .command("start <message>")
    .option("--request-id <id>")
    .action((message, options) =>
      write({ command: "start", message }, options.requestId),
    );
  command
    .command("send <sessionId> <message>")
    .option("--request-id <id>")
    .action((sessionId, message, options) =>
      write({ command: "send", sessionId, message }, options.requestId),
    );
  command
    .command("simulate <domain>")
    .option("--request-id <id>")
    .action((domain, options) =>
      write({ command: "start", simulation: true, domain }, options.requestId),
    );
  command
    .command("invoke <name>")
    .requiredOption("--input-file <path>")
    .option("--session <id>")
    .option("--request-id <id>")
    .action(async (name, options) => {
      try {
        const text = await readFile(options.inputFile, "utf8");
        if (text.length > 32000)
          throw new Error("Operation input is too large.");
        const argumentsJson = JSON.stringify(JSON.parse(text));
        await write(
          {
            command: options.session ? "send" : "start",
            ...(options.session ? { sessionId: options.session } : {}),
            message: `Execute ${name}`,
            toolName: name,
            toolArgumentsJson: argumentsJson,
          },
          options.requestId,
        );
      } catch (error) {
        printError(error instanceof Error ? error.message : "Invalid operation input");
        process.exitCode = 1;
      }
    });
  for (const kind of ["cancel", "retry"] as const)
    command
      .command(`${kind} <runId>`)
      .option("--request-id <id>")
      .action((runId, options) =>
        write({ command: kind, runId }, options.requestId),
      );
  for (const kind of ["approve", "reject"] as const)
    command
      .command(`${kind} <runId> <callId>`)
      .option("--request-id <id>")
      .action((runId, callId, options) =>
        write({ command: kind, runId, callId }, options.requestId),
      );
  return command;
}
