#!/usr/bin/env node

import { Command } from "commander";
import { createAuthCommand } from "./commands/auth.js";
import { createConfigCommand } from "./commands/config.js";
import { createAccountsCommand } from "./commands/accounts.js";
import { createContactsCommand } from "./commands/contacts.js";
import { createCampaignsCommand } from "./commands/campaigns.js";
import { createLinksCommand } from "./commands/links.js";
import { createResponsesCommand } from "./commands/responses.js";
import { createStoryTemplatesCommand } from "./commands/story-templates.js";
import { createInvitesCommand } from "./commands/invites.js";
import { createSmartIntakeCommand } from "./commands/smart-intake.js";

import { createInterviewsCommand } from "./commands/interviews.js";
import { createAdminCommand } from "./commands/admin.js";

const program = new Command();

program
  .name("pointed")
  .description(
    "Pointed CLI for managing accounts, contacts, campaigns, survey links, and response exports from the terminal.",
  )
  .version("0.5.0");

program.addCommand(createAuthCommand());
program.addCommand(createConfigCommand());
program.addCommand(createAccountsCommand());
program.addCommand(createContactsCommand());
program.addCommand(createCampaignsCommand());
program.addCommand(createLinksCommand());
program.addCommand(createResponsesCommand());
program.addCommand(createStoryTemplatesCommand());
program.addCommand(createInvitesCommand());
program.addCommand(createSmartIntakeCommand());

program.addCommand(createInterviewsCommand());
program.addCommand(createAdminCommand());

program.addHelpText(
  "after",
  `
From a spreadsheet to interviews:
  pointed story-templates starters                         # use cases: roi-stories, win-loss, ...
  pointed story-templates create --starter roi-stories --product "Pointed"
  pointed accounts import customers.csv --dry-run          # check how rows group into accounts
  pointed accounts import customers.csv --enroll <templateId>
  pointed story-templates get <templateId>                 # prepared invites, ready to review
  pointed invites email send <inviteId>                    # sending is always a separate step

Accounts and people:
  pointed accounts create --name "Acme" --domain acme.com --revenue 120000 --renewal-date 2027-03-31
  pointed accounts update <id> --field "Open opportunities=2" --context "What the interviewer should know"
  pointed accounts update <id> --industry Logistics --clear renewal-date
  pointed contacts create --account-id <id> --name "Jordan Lee" --email jordan@acme.com --phone "+1 415 555 0134"
`,
);

program.parse();
