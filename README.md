# Pointed CLI

Pointed CLI manages accounts, contacts, campaigns, story templates, survey links, invite email operations, smart intake, and response exports from the terminal.

## Install

Once published to npm:

```bash
npm install -g @pointed/cli
```

During development from this repository:

```bash
npm install
npm run build
npm link
```

Verify the binary:

```bash
pointed --help
```

## Authenticate

The CLI points at the hosted Pointed app by default:

```bash
pointed config get apiBaseUrl
```

Log in with browser-based OAuth:

```bash
pointed auth login
pointed auth whoami
```

For automation, set a Pointed-compatible Clerk API key:

```bash
export POINTED_API_KEY=your_api_key
pointed auth whoami
```

## Common Commands

```bash
pointed accounts list
pointed accounts create --name "Acme Corp" --industry "Technology"
pointed accounts update <accountId> --name "Acme Inc" --contract-value 120000

pointed contacts list --account-id <accountId>
pointed contacts create --account-id <accountId> --name "Jane Doe" --email jane@example.com
pointed contacts create-batch --account-id <accountId> --input-file contacts.json

pointed campaigns list --account-id <accountId>
pointed campaigns create \
  --account-id <accountId> \
  --name "Renewal proof" \
  --context "Collect customer ROI stories" \
  --initial-question "What outcome did this work unlock?"
pointed campaigns update <campaignId> --name "Updated title" --max-rounds 5

pointed links generate --campaign-id <campaignId>
pointed responses list --campaign-id <campaignId>
pointed responses download --campaign-id <campaignId> --output-dir ./pointed-export
```

## Smart Intake

Bulk-import accounts and contacts with AI-powered parsing:

```bash
pointed smart-intake preview --raw-input "Acme Corp, Jane Doe, jane@acme.com"
pointed smart-intake commit --session-id <sessionId> \
  --resolutions '[{"rowIndex":0,"action":"commit"}]'
```

## Story Templates

Story templates orchestrate account-level customer story collection. Enrollment prepares survey links; customer email is sent only when you call the invite email commands.

```bash
pointed story-templates create \
  --title "Renewal proof" \
  --customer-facing-name "ROI story" \
  --role "Economic buyer" \
  --goal "Capture ROI stories before renewal" \
  --initial-question "What changed after adopting the product?"

pointed story-templates list
pointed story-templates enrollment-options <templateId>
pointed story-templates enroll <templateId> --account-id <accountId> --auto-include-new-contacts
pointed story-templates account <templateId> <accountId>
pointed story-templates set-auto-include <templateId> <accountId> --enabled false
```

Preview and send invite email:

```bash
pointed invites email preview <inviteId>
pointed invites email send-test <inviteId> --email you@example.com
pointed invites email send <inviteId>
pointed invites email remind <inviteId>
```

## Configuration

The CLI stores local configuration in `~/.pointed/config.json` and OAuth credentials in `~/.pointed/credentials.json`.

Useful environment overrides:

- `POINTED_API_URL`: override the hosted API base URL
- `POINTED_OUTPUT_FORMAT`: set `json` or `table`
- `POINTED_API_KEY`: authenticate without stored OAuth credentials
- `CLERK_FRONTEND_API_URL`: override hosted Clerk OAuth discovery
- `CLERK_OAUTH_CLIENT_ID`: override the public OAuth client ID for development

## Documentation

Mintlify docs live in this repository under `docs/`.

## Development

```bash
npm install
npm run lint
npm run build
node dist/index.js --help
npm pack --dry-run
```

The npm package publishes only the built `dist/` output plus `README.md` and `LICENSE`.
