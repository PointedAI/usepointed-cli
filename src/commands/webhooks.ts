import { Command, InvalidArgumentError } from "commander";
import { apiRequest } from "../lib/api-client.js";
import { printError, printJson, printWarning } from "../lib/output.js";
import { encodeId, parsePositiveInteger } from "../lib/validation.js";

interface WebhookEndpoint {
  id: string;
  host: string;
  description: string | null;
  eventTypes: string[];
  receiveTestEvents: boolean;
  status: "active" | "pending_approval" | "paused" | "disabled";
  disabledReason: "gone" | "failing" | null;
  createdVia: "dashboard" | "api" | "connected_tool";
  createdAt: number;
  activeSince: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  failingSince: number | null;
  previousSecretValidUntil: number | null;
}

interface WebhookEndpointList {
  endpoints: WebhookEndpoint[];
  eventTypes: Array<{ type: string; description: string; default: boolean }>;
  maxEndpoints: number;
}

interface WebhookDelivery {
  id: string;
  eventId: string;
  eventType: string;
  test: boolean;
  trigger: "event" | "test" | "resend";
  interviewId: string | null;
  status: "pending" | "sending" | "delivered" | "failed" | "cancelled";
  attempts: number;
  maxAttempts: number;
  statusCode: number | null;
  errorCode: string | null;
  durationMs: number | null;
  createdAt: number;
  lastAttemptAt: number | null;
  deliveredAt: number | null;
  nextAttemptAt: number | null;
  resendable: boolean;
}

interface WebhookDeliveryPage {
  deliveries: WebhookDelivery[];
  nextCursor: string | null;
}

interface WebhookSend {
  deliveryId: string;
  eventId: string;
}

function fail(error: unknown): never {
  printError(error instanceof Error ? error.message : "Request failed");
  process.exit(1);
}

function eventList(value: string | undefined) {
  if (value === undefined) return undefined;
  const types = value.split(",").map((type) => type.trim());
  if (types.some((type) => type.length === 0)) {
    throw new Error("--events must be a comma-separated list of event types without empty entries");
  }
  return types;
}

function parseWaitSeconds(value: string): number {
  const seconds = parsePositiveInteger(value);
  if (seconds > 300) throw new InvalidArgumentError("Expected a whole number of seconds from 1 to 300");
  return seconds;
}

function parsePageSize(value: string): number {
  const size = parsePositiveInteger(value);
  if (size > 50) throw new InvalidArgumentError("Expected a page size from 1 to 50");
  return size;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const FINISHED = ["delivered", "failed", "cancelled"];

/** Reads the delivery log until one delivery has finished, or the time runs out. */
async function waitForDelivery(endpointId: string, deliveryId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await apiRequest<WebhookDeliveryPage>(
      "GET",
      `/webhook-endpoints/${encodeId(endpointId)}/deliveries`,
      undefined,
      { limit: "20" },
    );
    const delivery = res.data?.deliveries.find((row) => row.id === deliveryId);
    if (delivery && FINISHED.includes(delivery.status)) return delivery;
    if (Date.now() >= deadline) return delivery ?? null;
    await sleep(1500);
  }
}

export function createWebhooksCommand(): Command {
  const webhooks = new Command("webhooks").description(
    "Send interview events to your own HTTPS endpoint",
  );

  webhooks
    .command("events")
    .description("List the events an endpoint can receive")
    .action(async () => {
      try {
        const res = await apiRequest<WebhookEndpointList>("GET", "/webhook-endpoints");
        printJson(res.data?.eventTypes ?? []);
      } catch (error) {
        fail(error);
      }
    });

  webhooks
    .command("list")
    .description("List webhook endpoints")
    .action(async () => {
      try {
        const res = await apiRequest<WebhookEndpointList>("GET", "/webhook-endpoints");
        printJson(res.data);
      } catch (error) {
        fail(error);
      }
    });

  webhooks
    .command("get")
    .description("Show one webhook endpoint")
    .argument("<id>", "Endpoint ID")
    .action(async (id: string) => {
      try {
        const res = await apiRequest<{ endpoint: WebhookEndpoint }>("GET", `/webhook-endpoints/${encodeId(id)}`);
        printJson(res.data);
      } catch (error) {
        fail(error);
      }
    });

  webhooks
    .command("create")
    .description("Add an endpoint. The signing secret is printed once: store it now")
    .requiredOption("--url <url>", "Public HTTPS address that will receive events")
    .option("--description <text>", "A note for your team, such as what this endpoint feeds")
    .option("--events <types>", "Comma-separated event types (default: interview.completed)")
    .option("--test-events", "Also receive events from test interviews, marked test: true")
    .action(
      async (options: { url: string; description?: string; events?: string; testEvents?: boolean }) => {
        try {
          const res = await apiRequest<{ endpoint: WebhookEndpoint; secret: string; needsApproval: boolean; settingsUrl: string }>(
            "POST",
            "/webhook-endpoints",
            {
              url: options.url,
              description: options.description,
              eventTypes: eventList(options.events),
              receiveTestEvents: options.testEvents === true ? true : undefined,
            },
          );
          printJson(res.data);
          // Kept off stdout so a script parsing the JSON is not affected.
          printWarning("Store the signing secret now. It is not shown again; rotate it to get a new one.");
        } catch (error) {
          fail(error);
        }
      },
    );

  webhooks
    .command("update")
    .description("Change an endpoint, or pause and resume it")
    .argument("<id>", "Endpoint ID")
    .option("--url <url>", "New HTTPS address")
    .option("--description <text>", 'A note for your team; "" clears it')
    .option("--events <types>", "Comma-separated event types (replaces the current list)")
    .option("--test-events", "Receive events from test interviews")
    .option("--no-test-events", "Stop receiving events from test interviews")
    .option("--pause", "Stop sending to this endpoint")
    .option("--resume", "Turn a paused or turned-off endpoint back on. Events from while it was off are not sent. An endpoint saved by a connected tool is turned on in Pointed")
    .action(
      async (
        id: string,
        options: { url?: string; description?: string; events?: string; testEvents?: boolean; pause?: boolean; resume?: boolean },
      ) => {
        try {
          if (options.pause && options.resume) throw new Error("Pass either --pause or --resume, not both");
          const res = await apiRequest<{ endpoint: WebhookEndpoint }>("PATCH", `/webhook-endpoints/${encodeId(id)}`, {
            url: options.url,
            description: options.description,
            eventTypes: eventList(options.events),
            receiveTestEvents: options.testEvents,
            status: options.pause ? "paused" : options.resume ? "active" : undefined,
          });
          printJson(res.data);
        } catch (error) {
          fail(error);
        }
      },
    );

  webhooks
    .command("test")
    .description("Send one webhook.test event with sample data. It is sent once and not retried")
    .argument("<id>", "Endpoint ID")
    .option("--wait", "Wait for the result and print it (exits 1 unless it was delivered)")
    .option("--timeout <seconds>", "How long --wait waits, 1 to 300", parseWaitSeconds, 30)
    .action(async (id: string, options: { wait?: boolean; timeout: number }) => {
      try {
        const res = await apiRequest<WebhookSend>("POST", `/webhook-endpoints/${encodeId(id)}/test`);
        if (!options.wait || !res.data) {
          printJson(res.data);
          return;
        }
        const delivery = await waitForDelivery(id, res.data.deliveryId, options.timeout * 1000);
        printJson({ ...res.data, delivery });
        if (delivery?.status !== "delivered") process.exitCode = 1;
      } catch (error) {
        fail(error);
      }
    });

  webhooks
    .command("deliveries")
    .description("Show an endpoint's delivery log, newest first")
    .argument("<id>", "Endpoint ID")
    .option("--limit <count>", "Rows per page, 1 to 50", parsePageSize, 20)
    .option("--cursor <cursor>", "nextCursor from the previous page")
    .action(async (id: string, options: { limit: number; cursor?: string }) => {
      try {
        const query: Record<string, string> = { limit: String(options.limit) };
        if (options.cursor) query["cursor"] = options.cursor;
        const res = await apiRequest<WebhookDeliveryPage>("GET", `/webhook-endpoints/${encodeId(id)}/deliveries`, undefined, query);
        printJson(res.data);
      } catch (error) {
        fail(error);
      }
    });

  webhooks
    .command("resend")
    .description("Send a finished delivery again, with the same event ID")
    .argument("<deliveryId>", "Delivery ID from pointed webhooks deliveries")
    .action(async (deliveryId: string) => {
      try {
        const res = await apiRequest<WebhookSend>("POST", `/webhook-deliveries/${encodeId(deliveryId)}/resend`);
        printJson(res.data);
      } catch (error) {
        fail(error);
      }
    });

  webhooks
    .command("rotate-secret")
    .description("Issue a new signing secret. The previous one keeps working for 24 hours")
    .argument("<id>", "Endpoint ID")
    .action(async (id: string) => {
      try {
        const res = await apiRequest<{ endpoint: WebhookEndpoint; secret: string; previousSecretValidUntil: number }>(
          "POST",
          `/webhook-endpoints/${encodeId(id)}/rotate-secret`,
        );
        printJson(res.data);
        printWarning("Store the new signing secret now. It is not shown again.");
      } catch (error) {
        fail(error);
      }
    });

  webhooks
    .command("delete")
    .description("Delete an endpoint and its delivery log. Sending stops at once")
    .argument("<id>", "Endpoint ID")
    .action(async (id: string) => {
      try {
        const res = await apiRequest<{ deleted: boolean }>("DELETE", `/webhook-endpoints/${encodeId(id)}`);
        printJson(res.data);
      } catch (error) {
        fail(error);
      }
    });

  return webhooks;
}
