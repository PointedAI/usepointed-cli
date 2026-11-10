import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { apiRequest } from "../lib/api-client.js";
import { printJson, printError } from "../lib/output.js";
import { encodeId, parseContractValue } from "../lib/validation.js";

interface Account {
  _id: string;
  name: string;
  domain?: string;
  industry?: string;
  contractValue?: number;
  renewalDate?: number;
  notes?: string;
  customFields?: { label: string; value: string }[];
  createdAt: number;
}

type AccountOptions = {
  name?: string;
  domain?: string;
  website?: string;
  industry?: string;
  revenue?: number;
  contractValue?: number;
  renewalDate?: string;
  field?: string[];
  removeField?: string[];
  clear?: string;
  context?: string;
  contextFile?: string;
  notes?: string;
};

const CLEARABLE: Record<string, "contractValue" | "renewalDate"> = {
  revenue: "contractValue",
  "contract-value": "contractValue",
  "renewal-date": "renewalDate",
};

const collect = (value: string, previous: string[] = []) => [...previous, value];

/** "Open opportunities=2" → { label, value }. */
export function parseField(raw: string): { label: string; value: string } {
  const at = raw.indexOf("=");
  if (at <= 0) throw new Error(`--field takes Label=Value, like "Open opportunities=2" (got "${raw}")`);
  return { label: raw.slice(0, at).trim(), value: raw.slice(at + 1).trim() };
}

/** The request body for account create and update, from the shared options. */
export async function accountBody(options: AccountOptions): Promise<Record<string, unknown>> {
  if (options.context !== undefined && options.contextFile) throw new Error("Pass either --context or --context-file, not both");
  const fields = [
    ...(options.field ?? []).map(parseField),
    // An empty value removes a custom field.
    ...(options.removeField ?? []).map((label) => ({ label: label.trim(), value: "" })),
  ];
  const clear = options.clear?.split(",").map((name) => {
    const field = CLEARABLE[name.trim()];
    if (!field) throw new Error(`--clear takes revenue and/or renewal-date (got "${name.trim()}")`);
    return field;
  });
  const body: Record<string, unknown> = {
    name: options.name,
    domain: options.domain,
    website: options.website,
    industry: options.industry,
    contractValue: options.revenue ?? options.contractValue,
    renewalDate: options.renewalDate,
    notes: options.notes,
    fields: fields.length ? fields : undefined,
    clear,
    context: options.contextFile ? await readFile(options.contextFile, "utf8") : options.context,
  };
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

function accountOptions(command: Command, { forUpdate }: { forUpdate: boolean }): Command {
  if (forUpdate) command.option("--name <name>", "Rename the account");
  command
    .option("--domain <domain>", "Company domain, e.g. acme.com (people's emails must use it)")
    .option("--industry <industry>", "Industry")
    .option("--revenue <amount>", "Revenue / contract value, e.g. 120000", parseContractValue)
    .option("--contract-value <value>", "Same as --revenue", parseContractValue)
    .option("--renewal-date <date>", "Renewal date, YYYY-MM-DD")
    .option("--field <label=value>", 'A custom detail, e.g. "Open opportunities=2" (repeatable)', collect)
    .option("--context <text>", "Account context: what the interviewer should know about this customer")
    .option("--context-file <path>", "Read the account context from a file")
    .option("--notes <notes>", "Internal notes");
  if (forUpdate) {
    command
      .option("--website <url>", "Website")
      .option("--remove-field <label>", "Remove a custom detail (repeatable)", collect)
      .option("--clear <fields>", "Clear revenue and/or renewal-date, comma-separated");
  }
  return command;
}

async function run(action: () => Promise<unknown>) {
  try {
    const result = await action();
    printJson(result);
    // Account fields can save even when the separate context write fails.
    if (result && typeof result === "object" && "contextError" in result && result.contextError) process.exitCode = 1;
  } catch (error) {
    printError(error instanceof Error ? error.message : "Request failed");
    process.exitCode = 1;
  }
}

export function createAccountsCommand(): Command {
  const accounts = new Command("accounts").description("Manage accounts (customers) and their details");

  accounts
    .command("list")
    .description("List all accounts in the organization")
    .action(() => run(async () => (await apiRequest<Account[]>("GET", "/accounts")).data));

  accounts
    .command("get")
    .description("Get an account by ID")
    .argument("<id>", "Account ID")
    .action((id: string) => run(async () => (await apiRequest<Account>("GET", `/accounts/${encodeId(id)}`)).data));

  const create = accounts
    .command("create")
    .description("Create an account. Only the name is required; add people with `pointed contacts create`")
    .requiredOption("--name <name>", "Account name");
  accountOptions(create, { forUpdate: false });
  create.action((options: AccountOptions & { name: string }) =>
    run(async () => (await apiRequest<Account>("POST", "/accounts", await accountBody(options))).data),
  );

  const update = accounts
    .command("update")
    .description("Change an account's details, custom fields or context")
    .argument("<id>", "Account ID");
  accountOptions(update, { forUpdate: true });
  update.action((id: string, options: AccountOptions) =>
    run(async () => {
      const body = await accountBody(options);
      if (!Object.keys(body).length) throw new Error("Nothing to change. See `pointed accounts update --help`.");
      return (await apiRequest<Account>("PATCH", `/accounts/${encodeId(id)}`, body)).data;
    }),
  );

  accounts
    .command("context")
    .description("Show an account's context (set it with `accounts update <id> --context ...`)")
    .argument("<id>", "Account ID")
    .action((id: string) => run(async () => (await apiRequest("GET", `/accounts/${encodeId(id)}/context`)).data));

  accounts
    .command("import")
    .description(
      "Create accounts and their contacts from a spreadsheet (CSV). Columns are matched by header: " +
        "Company, Domain, Industry, Name or First/Last name, Email, Job title, Phone. " +
        "Companies already in Pointed are reused.",
    )
    .argument("<file>", "Path to a .csv (or tab-separated) file")
    .option("--enroll <templateId>", "Then enroll everyone in the file in this interview template (prepares links, sends nothing)")
    .option("--dry-run", "Show how the file would be grouped without creating anything")
    .action((file: string, options: { enroll?: string; dryRun?: boolean }) =>
      run(async () => {
        const csv = await readFile(file, "utf8");
        const templateId = options.enroll === undefined ? undefined : encodeId(options.enroll);
        const { data } = await apiRequest<{
          summary?: { accountsFailed: number; contactsFailed: number };
          enrollment?: { error?: string };
        }>("POST", "/accounts/import", { csv, templateId, dryRun: options.dryRun });
        if ((data?.summary?.accountsFailed ?? 0) > 0 || (data?.summary?.contactsFailed ?? 0) > 0 || data?.enrollment?.error) {
          process.exitCode = 1;
        }
        return data;
      }),
    );

  return accounts;
}
