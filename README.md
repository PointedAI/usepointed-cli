# Pointed CLI

Pointed CLI manages accounts, contacts, campaigns, story templates, survey links, invite email operations, smart intake, and response exports from the terminal.

## Install

Install the public npm package:

```bash
npm install -g @pointed/cli
```

Use macOS or Linux and Node.js 20 or newer. Node.js 22 is recommended for repository development. Native Windows is not currently supported because the CLI's private-file checks require POSIX ownership and permissions.

You need an existing Pointed account with workspace access. New users can [request access](https://usepointed.ai/contact?reason=general); installing the CLI does not create an account. Start with the [quickstart](https://docs.usepointed.ai/docs/quickstart) for a complete first run.

**Source availability:** this branch is preparing 0.5.0. The new spreadsheet imports, account/context fields, contact phones and template shortcuts below are not yet on npm; the latest published version is 0.4.0. Run from source to use them now.

During development from this repository:

```bash
npm ci
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

Select your workspace and approve the requested Pointed permissions. After the
OAuth authorization update, run `pointed auth login` again; existing tokens do not
gain the new permissions through refresh. Platform administrators can request
additional consent with `pointed auth login --admin`.

Complete login in a browser on the same computer; the CLI listens for a callback on `127.0.0.1:3100`. For automation, set an existing Pointed-compatible Clerk API key authorized for your workspace:

```bash
export POINTED_API_KEY=your_api_key
pointed auth whoami
```

The CLI does not issue API keys. [Contact Pointed](https://usepointed.ai/contact?reason=general) to confirm provisioning if you need one. API keys take precedence over stored browser credentials; see [Authentication](https://docs.usepointed.ai/docs/authentication) for refresh, logout, and configuration details.

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

## Spreadsheet to interviews (0.5.0 source)

```bash
pointed story-templates starters
pointed story-templates create --starter roi-stories --product "Your product" --interview-length quick
pointed accounts import customers.csv --dry-run
pointed accounts import customers.csv --enroll <templateId>
pointed story-templates get <templateId>
```

CSV/TSV headers can identify Company, Domain, Industry, Name (or First/Last name), Email, Job title and Phone. Imports are limited to 2 MB of UTF-8 CSV, 1,000 accounts and 1,000 contacts per request; split larger files. Dry runs create nothing. Enrollment prepares links and sends no email. Review skipped rows and partial results before retrying.

```bash
pointed accounts create --name "Acme" --domain acme.example --revenue 120000 --renewal-date 2027-03-31
pointed accounts update <accountId> --field "Open opportunities=2" --context-file briefing.txt
pointed accounts update <accountId> --remove-field "Open opportunities" --clear renewal-date
pointed accounts context <accountId>
pointed contacts update <contactId> --phone "+1 415 555 0134"
pointed story-templates enroll <templateId> --account-ids accountA,accountB
```

Use either `--account-ids` or `--all-accounts`; these whole-account modes cannot be combined with single-account/contact selectors or JSON selections. `--contract-value` remains a strict numeric alias for `--revenue` on create and update. Context replaces the saved briefing. If its write fails after account creation, retry with `accounts update` using the returned account ID.

See the [account import guide](https://docs.usepointed.ai/docs/account-imports) and [template guide](https://docs.usepointed.ai/docs/story-templates).

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

## Local file safety

Local file security checks require POSIX ownership and permissions (macOS/Linux); Windows ACL validation is not implemented. Unsupported ownership checks fail closed for local state and exports.

OAuth state uses an owned, private `~/.pointed` directory (0700) and regular JSON files (0600). Reads, saves, and logout refuse unsafe permissions, symlinks, hard links, or files owned by another user. Fix unsafe existing state before retrying; the CLI does not follow or overwrite those objects.

Response downloads create a fresh private directory for each export, with owner-only files. Repeated downloads preserve earlier exports. The selected output directory must be owned by you and not writable by other users. Exported filenames cannot escape that directory.

## Automation results

Account imports print complete results and exit with status 1 for failed account/contact writes or enrollment. Account create/update also exits with status 1 when the separate context write fails, retaining the saved account and `contextError` in JSON.

Contact batches and link generation print their complete results and exit with status 1 if any item fails. Response downloads also exit with status 1 when a response or ready video cannot be exported, while preserving completed files. Export manifests record the final download outcomes; media still preparing or unavailable remains a warning.

Explicitly empty contact selectors are rejected. Omit both selectors only when you intend to include all account contacts. Contract values accept finite nonnegative numbers without thousands separators; maximum rounds must be a positive integer.

## Documentation

Read the live [Pointed CLI documentation](https://docs.usepointed.ai/docs/quickstart). The source lives in this repository under `docs/`, with navigation and branding in `docs.json`. Mintlify deploys the `main` branch automatically. Preview changes locally before opening a pull request, and check the Mintlify deployment result on GitHub after changes merge.

The public [documentation MCP server](https://docs.usepointed.ai/mcp) searches the guides and accepts documentation feedback. It cannot access or change your Pointed workspace. See [AI tools and documentation](https://docs.usepointed.ai/docs/ai-tools) for the distinction between documentation lookup and using the CLI from an agent.

Preview and validate documentation changes locally with the [Mintlify CLI](https://www.mintlify.com/docs/cli/commands):

```bash
npx mint dev
npx mint validate
npx mint broken-links --check-anchors
```

## Development

```bash
npm ci
npm run lint
npm test
npm run build
node dist/index.js --help
npm pack --dry-run
```

The npm package publishes only the built `dist/` output plus `README.md` and `LICENSE`.

## ElevenLabs interview settings

Configure reusable Demo Mode links or interview templates without starting a call:

```bash
pointed interviews settings list --kind demo
pointed interviews settings list --kind story_template
pointed interviews settings get <targetId> --kind demo > interview-settings.json
pointed interviews settings provider --kind demo --id <targetId> --channel browser_audio
pointed interviews settings set <targetId> --kind demo --file interview-settings.json
```

`settings get` exports `expectedRevision`, `openingQuestion`, `context`, `instructions`, and `elevenLabsSettingsJson`. Advanced JSON uses native ElevenLabs `conversation_config` names. `{}` uses Pointed's standard connection defaults; inspect effective model, voice, turn and other tuning values with `settings provider` before changing them. Use `--channel phone` to inspect phone defaults. Provider credentials, tools, consent and security remain managed by Pointed.

Keep `expectedRevision` while editing. A conflict exits with status 1, prints the current revision as JSON, and leaves your file intact. Read the latest settings and reconcile your edits before another save. The CLI does not automatically retry conflicting writes. List results are paginated; continue with `--cursor` until `nextCursor` is null. `--limit` accepts 1–25.

Saving requires a user-backed workspace writer with `pointed:write`. It may provision an isolated provider configuration, but does not send invitations or start calls or recordings. Settings affect future runs; existing invitations retain their frozen configuration.

### Founder voice settings

Platform administrators can inspect founder demos and configure their browser voice or phone channels after `pointed auth login --admin`:

```bash
pointed admin demos list
pointed admin demos get <definitionId>
pointed admin demos voice-settings get <definitionId> --channel phone > phone-settings.json
pointed admin demos voice-settings set <definitionId> --file phone-settings.json
```

Use `--channel browser_audio` for browser voice. The editable envelope contains `channel`, `expectedRevision`, and `configuration`, including `elevenLabsSettingsJson`. Blank connection identifiers resolve to the standard Pointed connection on the server. The server rechecks current platform-admin authority before committing a save. These commands configure voice channels independently of the founder text-interview engine and do not initiate a call.


When enrolling accounts, omit auto-include flags to inherit the template default for new enrollments (existing enrollments keep their choice). Use `--auto-include-new-contacts` or `--no-auto-include-new-contacts` for an explicit choice. The opt-out flag is in the upcoming 0.5.0 source version. A template-wide auto-add change in the app replaces all enrolled accounts' choices; auto-add prepares interviews without sending them. See the [template guide](https://docs.usepointed.ai/docs/story-templates).
