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

const program = new Command();

program
  .name("pointed")
  .description(
    "Pointed CLI for managing accounts, contacts, campaigns, survey links, and response exports from the terminal.",
  )
  .version("0.1.0");

program.addCommand(createAuthCommand());
program.addCommand(createConfigCommand());
program.addCommand(createAccountsCommand());
program.addCommand(createContactsCommand());
program.addCommand(createCampaignsCommand());
program.addCommand(createLinksCommand());
program.addCommand(createResponsesCommand());
program.addCommand(createStoryTemplatesCommand());
program.addCommand(createInvitesCommand());

program.parse();
