import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));

async function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pointed-cli-commands-'));
  fs.chmodSync(home, 0o700);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const requests = [];
  let result = {};
  let status = 200;
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    requests.push({ method: request.method, url: request.url, body: raw ? JSON.parse(raw) : undefined });
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: result }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return {
    home,
    requests,
    respond(value, statusCode = 200) { result = value; status = statusCode; },
    run(args) {
      return new Promise((resolve, reject) => {
        // An isolated home and explicit dummy credentials prevent use of local auth state.
        const child = spawn(process.execPath, [cli, ...args], {
          cwd: home,
          env: {
            ...process.env,
            HOME: home,
            POINTED_API_KEY: 'local-fixture-only',
            POINTED_API_URL: `http://127.0.0.1:${server.address().port}`,
            POINTED_OUTPUT_FORMAT: 'json',
          },
        });
        let stdout = '', stderr = '';
        const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', data => stdout += data);
        child.stderr.on('data', data => stderr += data);
        child.on('error', error => { clearTimeout(timeout); reject(error); });
        child.on('close', (code, signal) => {
          clearTimeout(timeout);
          if (signal) reject(new Error(`CLI terminated by ${signal}: ${stderr}`));
          else resolve({ code, stdout, stderr });
        });
      });
    },
  };
}

async function rejectsBeforeRequest(f, args) {
  const before = f.requests.length;
  const result = await f.run(args);
  assert.notEqual(result.code, 0, `Accepted ${JSON.stringify(args)}: ${result.stdout}`);
  assert.equal(f.requests.length, before, `Sent a request for ${JSON.stringify(args)}`);
  assert.notEqual(result.stderr, '', 'A rejected command must explain its failure');
}

const pathCommands = [
  id => ['interviews', 'settings', 'get', id],
  id => ['interviews', 'settings', 'provider', '--id', id, '--channel', 'phone'],
  id => ['admin', 'demos', 'get', id],
  id => ['admin', 'demos', 'voice-settings', 'get', id, '--channel', 'browser_audio'],
  id => ['accounts', 'get', id],
  id => ['accounts', 'update', id, '--name', 'Account'],
  id => ['contacts', 'get', id],
  id => ['contacts', 'update', id, '--name', 'Contact'],
  id => ['contacts', 'delete', id],
  id => ['campaigns', 'get', id],
  id => ['campaigns', 'update', id, '--name', 'Campaign'],
  id => ['links', 'generate', '--campaign-id', id],
  id => ['story-templates', 'get', id],
  id => ['story-templates', 'update', id, '--title', 'Template'],
  id => ['story-templates', 'delete', id],
  id => ['story-templates', 'enrollment-options', id],
  id => ['story-templates', 'enroll', id, '--account-id', 'account-1'],
  id => ['story-templates', 'account', id, 'account-1'],
  id => ['story-templates', 'account', 'template-1', id],
  id => ['story-templates', 'set-auto-include', id, 'account-1', '--enabled', 'true'],
  id => ['story-templates', 'set-auto-include', 'template-1', id, '--enabled', 'true'],
  id => ['invites', 'email', 'preview', id],
  id => ['invites', 'email', 'send-test', id],
  id => ['invites', 'email', 'send', id],
  id => ['invites', 'email', 'remind', id],
  id => ['invites', 'delivery-issue', 'clear', id],
  id => ['responses', 'list', '--campaign-id', id],
  id => ['responses', 'download', '--campaign-id', id],
  id => ['responses', 'download', '--campaign-id', id, '--response-id', 'response-1'],
  id => ['responses', 'download', '--campaign-id', 'campaign-1', '--response-id', id],
];

test('every dynamic path argument rejects endpoint injection before sending a request', async t => {
  const f = await fixture(t);
  for (const command of pathCommands) {
    await rejectsBeforeRequest(f, command('invite-1/email/send?ignored='));
  }
});

test('path validation rejects traversal, encoded delimiters, queries, fragments, controls and empty IDs', async t => {
  const f = await fixture(t);
  const invalidIds = ['', ' ', '.', '..', '../send', 'id/other', 'id\\other', 'id?send=true', 'id#preview',
    '%2e%2e', 'id%2fsend', 'id%252fsend', 'id\nother'];
  for (let index = 0; index < invalidIds.length; index++) {
    await rejectsBeforeRequest(f, pathCommands[index % pathCommands.length](invalidIds[index]));
    await rejectsBeforeRequest(f, ['invites', 'email', 'preview', invalidIds[index]]);
  }
  // An explicitly empty response ID must not silently switch to the all-responses operation.
  await rejectsBeforeRequest(f, ['responses', 'download', '--campaign-id', 'campaign-1', '--response-id', '']);
});

test('valid IDs retain their exact endpoint and preview never becomes send', async t => {
  const f = await fixture(t);
  const validId = 'ABC_123-safe';
  for (const [args, method, endpoint] of [
    [['accounts', 'get', validId], 'GET', `/accounts/${validId}`],
    [['contacts', 'delete', validId], 'DELETE', `/contacts/${validId}`],
    [['story-templates', 'account', validId, 'account-1'], 'GET', `/story-templates/${validId}/accounts/account-1`],
    [['invites', 'email', 'preview', validId], 'POST', `/invites/${validId}/email/preview`],
  ]) {
    const result = await f.run(args);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(f.requests.at(-1).url, `/api/cli/v1${endpoint}`);
    assert.equal(f.requests.at(-1).method, method);
  }
});

const selectionCommands = [
  ['links', 'generate', '--campaign-id', 'campaign-1'],
  ['story-templates', 'enroll', 'template-1', '--account-id', 'account-1'],
];

test('explicitly empty contact selectors fail closed, including partially empty CSV lists', async t => {
  const f = await fixture(t);
  for (const command of selectionCommands) {
    for (const option of ['--contact-ids', '--contact-emails']) {
      for (const value of ['', '   ', ',', ' , , ', 'one,,two', ',one', 'one,']) {
        await rejectsBeforeRequest(f, [...command, option, value]);
      }
    }
  }
  await rejectsBeforeRequest(f, ['story-templates', 'enroll', 'template-1', '--account-id', '']);
  await rejectsBeforeRequest(f, ['links', 'generate', '--campaign-id', 'campaign-1', '--contact-ids', '', '--contact-emails', 'person@example.com']);
});

test('omitted selectors remain omitted and valid CSV selectors preserve requested contacts', async t => {
  const f = await fixture(t);
  for (const command of selectionCommands) {
    for (const [selector, value, expected] of [
      [null, null, {}],
      ['--contact-ids', 'contact-1, contact_2', { contactIds: ['contact-1', 'contact_2'] }],
      ['--contact-emails', 'one@example.com, two@example.com', { contactEmails: ['one@example.com', 'two@example.com'] }],
    ]) {
      const result = await f.run([...command, ...(selector ? [selector, value] : [])]);
      assert.equal(result.code, 0, result.stderr);
      const scope = command[0] === 'links' ? { campaignId: 'campaign-1' } : { accountId: 'account-1' };
      assert.deepEqual(f.requests.at(-1).body, { ...scope, ...expected });
    }
  }
});

test('template enrollment rejects conflicting selectors after merging flags and JSON bodies', async t => {
  const f = await fixture(t);
  const command = ['story-templates', 'enroll', 'template-1', '--account-id', 'account-1'];
  const inputFile = path.join(f.home, 'selection.json');
  fs.writeFileSync(inputFile, JSON.stringify({ contactEmails: ['person@example.com'] }));
  for (const options of [
    ['--contact-ids', 'contact-1', '--contact-emails', 'person@example.com'],
    ['--contact-ids', 'contact-1', '--data', JSON.stringify({ contactEmails: ['person@example.com'] })],
    ['--contact-ids', 'contact-1', '--input-file', inputFile],
    ['--contact-emails', 'person@example.com', '--data', JSON.stringify({ contactIds: ['contact-1'] })],
    ['--data', JSON.stringify({ contactIds: ['contact-1'], contactEmails: ['person@example.com'] })],
  ]) {
    await rejectsBeforeRequest(f, [...command, ...options]);
  }
});

test('template JSON and file bodies preserve advanced selections and flag override behavior', async t => {
  const f = await fixture(t);
  const command = ['story-templates', 'enroll', 'template-1'];
  const inputFile = path.join(f.home, 'enrollment.json');
  for (const body of [
    { accountId: 'account-1', contactIds: ['contact-1'], autoIncludeNewContacts: false },
    { accountId: 'account-1', contactEmails: [], autoIncludeNewContacts: true },
    { selections: [{ accountId: 'account-1', contactIds: ['contact-1'] }, { accountId: 'account-2', contactEmails: ['person@example.com'] }] },
  ]) {
    fs.writeFileSync(inputFile, JSON.stringify(body));
    for (const options of [['--data', JSON.stringify(body)], ['--input-file', inputFile]]) {
      const result = await f.run([...command, ...options]);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(f.requests.at(-1).body, body);
    }
  }
  const original = { accountId: 'account-1', contactIds: ['old-contact'], autoIncludeNewContacts: false };
  for (const source of ['--data', '--input-file']) {
    fs.writeFileSync(inputFile, JSON.stringify(original));
    const result = await f.run([...command, source, source === '--data' ? JSON.stringify(original) : inputFile,
      '--account-id', 'account-2', '--contact-ids', 'new-contact', '--auto-include-new-contacts']);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(f.requests.at(-1).body, { accountId: 'account-2', contactIds: ['new-contact'], autoIncludeNewContacts: true });
  }
});

test('batch failures set a nonzero status without truncating machine-readable result details', async t => {
  const f = await fixture(t);
  const inputFile = path.join(f.home, 'contacts.json');
  fs.writeFileSync(inputFile, JSON.stringify([{ name: 'Person', email: 'person@example.com' }]));
  const contactCommand = ['contacts', 'create-batch', '--account-id', 'account-1', '--input-file', inputFile];
  const linkCommand = ['links', 'generate', '--campaign-id', 'campaign-1'];
  // Exceed a pipe's buffer to catch process.exit(1) discarding pending stdout writes.
  const longError = 'Result detail. '.repeat(16_384);
  for (const [command, result] of [
    [contactCommand, { requested: 1, created: 0, existing: 0, failed: 1, results: [{ index: 0, status: 'error', error: longError }] }],
    [contactCommand, { requested: 2, created: 1, existing: 0, failed: 1, results: [{ index: 0, status: 'created', contact: { _id: 'contact-1' } }, { index: 1, status: 'error', error: longError }] }],
    [linkCommand, { requested: 1, succeeded: 0, failed: 1, results: [{ index: 0, status: 'error', contactId: 'contact-1', error: longError }] }],
    [linkCommand, { requested: 2, succeeded: 1, failed: 1, results: [{ index: 0, status: 'success', contactId: 'contact-1', surveyUrl: 'https://example.com/survey' }, { index: 1, status: 'error', contactId: 'contact-2', error: longError }] }],
  ]) {
    f.respond(result);
    const actual = await f.run(command);
    assert.notEqual(actual.code, 0);
    assert.deepEqual(JSON.parse(actual.stdout), result);
  }
});

test('successful batches and duplicate-existing contacts remain successful', async t => {
  const f = await fixture(t);
  const inputFile = path.join(f.home, 'contacts.json');
  fs.writeFileSync(inputFile, '[]');
  for (const [command, result] of [
    [['contacts', 'create-batch', '--account-id', 'account-1', '--input-file', inputFile], {
      requested: 2, created: 1, existing: 1, failed: 0,
      results: [{ index: 0, status: 'created', contact: { _id: 'contact-1' } }, { index: 1, status: 'existing', contact: { _id: 'contact-2' } }],
    }],
    [['links', 'generate', '--campaign-id', 'campaign-1'], {
      requested: 1, succeeded: 1, failed: 0,
      results: [{ index: 0, status: 'success', contactId: 'contact-1', surveyUrl: 'https://example.com/survey' }],
    }],
  ]) {
    f.respond(result);
    const actual = await f.run(command);
    assert.equal(actual.code, 0, actual.stderr);
    assert.deepEqual(JSON.parse(actual.stdout), result);
  }
});

const accountCommands = [
  ['accounts', 'create', '--name', 'Account'],
  ['accounts', 'update', 'account-1'],
];

test('contract values reject partial, nonfinite and negative input before any request', async t => {
  const f = await fixture(t);
  for (const command of accountCommands) {
    for (const value of ['', ' ', '120,000', '120garbage', 'NaN', 'Infinity', '-1', '1e999']) {
      await rejectsBeforeRequest(f, [...command, '--contract-value', value]);
    }
    for (const [value, expected] of [['0', 0], ['120000', 120000], ['123.45', 123.45]]) {
      const result = await f.run([...command, '--contract-value', value]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(f.requests.at(-1).body.contractValue, expected);
    }
  }
});

const maxRoundsCommands = [
  ['campaigns', 'create', '--account-id', 'account-1', '--name', 'Campaign', '--context', 'Context', '--initial-question', 'Question'],
  ['campaigns', 'update', 'campaign-1'],
  ['story-templates', 'create', '--title', 'Template', '--role', 'Customer', '--goal', 'Learn', '--initial-question', 'Question'],
  ['story-templates', 'update', 'template-1'],
];

test('maximum rounds require a complete positive safe integer in every create and update command', async t => {
  const f = await fixture(t);
  for (const command of maxRoundsCommands) {
    for (const value of ['', '2.9', '2garbage', '0', '-1', 'NaN', 'Infinity', '9007199254740992']) {
      await rejectsBeforeRequest(f, [...command, '--max-rounds', value]);
    }
    const result = await f.run([...command, '--max-rounds', '3']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(f.requests.at(-1).body.maxRounds, 3);
  }
});

test('unsupported department options are rejected instead of reporting a successful no-op', async t => {
  const f = await fixture(t);
  for (const command of [
    ['contacts', 'create', '--account-id', 'account-1', '--name', 'Person', '--email', 'person@example.com'],
    ['contacts', 'update', 'contact-1'],
  ]) {
    await rejectsBeforeRequest(f, [...command, '--department', 'Engineering']);
    const help = await f.run([...command.slice(0, 2), '--help']);
    assert.equal(help.code, 0, help.stderr);
    assert.doesNotMatch(help.stdout, /--department/);
  }
});

test('interview settings round-trip the revision and exact native JSON without extra metadata', async t => {
  const f = await fixture(t);
  const native = JSON.stringify({ agent: { prompt: { llm: 'gpt-4o-mini', temperature: 0.2 } }, turn: { turn_eagerness: 'patient' } }, null, 2);
  const settings = { revision: 7, openingQuestion: 'What changed?', context: 'Product context', instructions: 'Let people finish.', elevenLabsSettingsJson: native,
    interviewChannel: 'browser_video', target: { kind: 'story_template', id: 'template-1' }, actorId: 'private-internal-actor', url: 'https://app.usepointed.ai/dashboard' };
  f.respond(settings);
  const fetched = await f.run(['interviews', 'settings', 'get', 'template-1', '--kind', 'story_template']);
  assert.equal(fetched.code, 0, fetched.stderr);
  const editable = JSON.parse(fetched.stdout);
  assert.deepEqual(editable, { expectedRevision: 7, openingQuestion: settings.openingQuestion, context: settings.context, instructions: settings.instructions, elevenLabsSettingsJson: native, interviewChannel: 'browser_video' });
  assert.equal(f.requests.at(-1).url, '/api/cli/v1/interview-settings/story_template/template-1');
  const file = path.join(f.home, 'settings.json');
  fs.writeFileSync(file, JSON.stringify(editable));
  f.respond({ status: 'saved', revision: 8 });
  const saved = await f.run(['interviews', 'settings', 'set', 'template-1', '--kind', 'story_template', '--file', file]);
  assert.equal(saved.code, 0, saved.stderr);
  assert.deepEqual(f.requests.at(-1), { method: 'PUT', url: '/api/cli/v1/interview-settings/story_template/template-1', body: editable });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), editable);
});

test('template settings keep legacy, single-channel and participant-choice selections, while demos omit camera settings', async t => {
  const f = await fixture(t);
  const base = { revision: 4, openingQuestion: 'How was it?', context: '', instructions: '', elevenLabsSettingsJson: '{}' };
  const file = path.join(f.home, 'settings.json');
  for (const channel of [null, 'browser_audio', 'phone', 'participant_choice', undefined]) {
    f.respond({ ...base, interviewChannel: channel });
    const result = await f.run(['interviews', 'settings', 'get', 'template-1', '--kind', 'story_template']);
    assert.equal(result.code, 0, result.stderr);
    const editable = JSON.parse(result.stdout);
    assert.equal(editable.interviewChannel, channel);
    fs.writeFileSync(file, JSON.stringify(editable));
    const saved = await f.run(['interviews', 'settings', 'set', 'template-1', '--kind', 'story_template', '--file', file]);
    assert.equal(saved.code, 0, saved.stderr);
    assert.deepEqual(f.requests.at(-1).body, editable);
  }
  f.respond({ ...base, interviewChannel: null });
  const demo = await f.run(['interviews', 'settings', 'get', 'demo-1']);
  assert.equal(demo.code, 0, demo.stderr);
  assert.equal('interviewChannel' in JSON.parse(demo.stdout), false);
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(demo.stdout), interviewChannel: 'browser_video' }));
  await rejectsBeforeRequest(f, ['interviews', 'settings', 'set', 'demo-1', '--file', file]);
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(demo.stdout), interviewChannel: 'bogus' }));
  await rejectsBeforeRequest(f, ['interviews', 'settings', 'set', 'template-1', '--kind', 'story_template', '--file', file]);
});

test('interview list and provider reads retain explicit kind, pagination and channel', async t => {
  const f = await fixture(t);
  f.respond({ items: [], nextCursor: 'next&cursor' });
  const listed = await f.run(['interviews', 'settings', 'list', '--kind', 'story_template', '--cursor', 'next&cursor', '--limit', '7']);
  assert.equal(listed.code, 0, listed.stderr);
  const url = new URL(f.requests.at(-1).url, 'https://example.com');
  assert.equal(url.pathname, '/api/cli/v1/interview-settings');
  assert.equal(url.searchParams.get('kind'), 'story_template');
  assert.equal(url.searchParams.get('cursor'), 'next&cursor');
  assert.equal(url.searchParams.get('limit'), '7');
  const tuning = { settingsJson: '{"turn":{"turn_eagerness":"patient"}}' };
  f.respond(tuning);
  const provider = await f.run(['interviews', 'settings', 'provider', '--kind', 'demo', '--id', 'demo-1', '--channel', 'phone']);
  assert.equal(provider.code, 0, provider.stderr);
  assert.equal(f.requests.at(-1).url, '/api/cli/v1/interview-settings/demo/demo-1/provider?channel=phone');
  assert.deepEqual(JSON.parse(provider.stdout), tuning);
  for (const count of ['0', '26', '2.5', 'garbage']) await rejectsBeforeRequest(f, ['interviews', 'settings', 'list', '--limit', count]);
});

test('founder native voice settings use the admin endpoint without selecting an engine or starting a call', async t => {
  const f = await fixture(t);
  const settings = { channel: 'phone', expectedRevision: 3, configuration: { enabled: true, agentId: '', agentPhoneNumberId: '', voiceId: '', elevenLabsSettingsJson: '{}' } };
  f.respond(settings);
  const fetched = await f.run(['admin', 'demos', 'voice-settings', 'get', 'definition-1', '--channel', 'phone']);
  assert.equal(fetched.code, 0, fetched.stderr);
  assert.equal(f.requests.at(-1).url, '/api/cli/v1/admin/demos/definition-1/voice-settings?kind=founder&channel=phone');
  const file = path.join(f.home, 'voice-settings.json');
  fs.writeFileSync(file, fetched.stdout);
  f.respond({ status: 'saved', revision: 4 });
  const saved = await f.run(['admin', 'demos', 'voice-settings', 'set', 'definition-1', '--file', file]);
  assert.equal(saved.code, 0, saved.stderr);
  assert.deepEqual(f.requests.at(-1), { method: 'PUT', url: '/api/cli/v1/admin/demos/definition-1/voice-settings?kind=founder', body: settings });
  assert.equal(f.requests.length, 2);
});

test('settings conflicts retain the current revision in JSON and never retry automatically', async t => {
  const f = await fixture(t);
  const ordinary = { expectedRevision: 1, openingQuestion: 'Question', context: '', instructions: '', elevenLabsSettingsJson: '{}' };
  const native = { channel: 'browser_audio', expectedRevision: 1, configuration: { enabled: false } };
  for (const [body, command] of [[ordinary, ['interviews', 'settings', 'set', 'demo-1']], [native, ['admin', 'demos', 'voice-settings', 'set', 'definition-1']]]) {
    const file = path.join(f.home, 'conflict.json');
    fs.writeFileSync(file, JSON.stringify(body));
    f.respond({ status: 'conflict', revision: 9 }, 409);
    const count = f.requests.length;
    const result = await f.run([...command, '--file', file]);
    assert.equal(result.code, 1);
    assert.deepEqual(JSON.parse(result.stdout), { status: 'conflict', revision: 9 });
    assert.match(result.stderr, /reconcile/);
    assert.equal(f.requests.length, count + 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), body);
  }
});

test('malformed settings files fail before network access', async t => {
  const f = await fixture(t);
  const file = path.join(f.home, 'invalid-settings.json');
  const ordinary = { expectedRevision: 0, openingQuestion: 'Question', context: '', instructions: '' };
  const native = { channel: 'phone', expectedRevision: 0, configuration: {} };
  for (const [command, invalid] of [
    [['interviews', 'settings', 'set', 'demo-1'], [[], null, { ...ordinary, expectedRevision: -1 }, { ...ordinary, orgId: 'spoof' }, { ...ordinary, instructions: 5 }]],
    [['admin', 'demos', 'voice-settings', 'set', 'definition-1'], [[], null, { ...native, expectedRevision: 1.5 }, { ...native, channel: 'realtime' }, { ...native, clerkUserId: 'spoof' }]],
  ]) for (const body of invalid) {
    fs.writeFileSync(file, JSON.stringify(body));
    await rejectsBeforeRequest(f, [...command, '--file', file]);
  }
});

test('account details and context reach the API while both money aliases stay numeric', async t => {
  const f = await fixture(t);
  const contextFile = path.join(f.home, 'context.txt');
  fs.writeFileSync(contextFile, 'Account briefing from a file.');
  const created = await f.run(['accounts', 'create', '--name', 'Acme', '--domain', 'acme.example', '--revenue', '120000', '--renewal-date', '2027-03-31', '--field', 'Tier=Gold', '--context-file', contextFile]);
  assert.equal(created.code, 0, created.stderr);
  assert.deepEqual(f.requests.at(-1).body, { name: 'Acme', domain: 'acme.example', contractValue: 120000, renewalDate: '2027-03-31', fields: [{ label: 'Tier', value: 'Gold' }], context: 'Account briefing from a file.' });
  const updated = await f.run(['accounts', 'update', 'account-1', '--website', 'https://acme.example', '--contract-value', '150000', '--clear', 'renewal-date', '--remove-field', 'Tier', '--context', 'Updated briefing.']);
  assert.equal(updated.code, 0, updated.stderr);
  assert.deepEqual(f.requests.at(-1), { method: 'PATCH', url: '/api/cli/v1/accounts/account-1', body: { website: 'https://acme.example', contractValue: 150000, clear: ['renewalDate'], fields: [{ label: 'Tier', value: '' }], context: 'Updated briefing.' } });
  f.respond({ text: 'Updated briefing.', revision: 2 });
  const context = await f.run(['accounts', 'context', 'account-1']);
  assert.equal(context.code, 0, context.stderr);
  assert.equal(f.requests.at(-1).url, '/api/cli/v1/accounts/account-1/context');
  assert.deepEqual(JSON.parse(context.stdout), { text: 'Updated briefing.', revision: 2 });
});

test('account additions preserve pre-request validation', async t => {
  const f = await fixture(t);
  for (const args of [
    ['accounts', 'context', '../send'],
    ['accounts', 'create', '--name', 'Acme', '--revenue', '120000oops'],
    ['accounts', 'update', 'account-1', '--revenue', 'Infinity'],
    ['accounts', 'update', 'account-1', '--context', 'one', '--context-file', 'missing.txt'],
    ['accounts', 'update', 'account-1', '--field', 'Missing equals'],
    ['accounts', 'update', 'account-1', '--clear', 'name'],
    ['accounts', 'update', 'account-1'],
  ]) await rejectsBeforeRequest(f, args);
});

test('CSV import sends the file unchanged with explicit dry-run and enrollment scope', async t => {
  const f = await fixture(t);
  const csv = 'Company,Domain,Name,Email,Phone\nAcme,acme.example,Jane,jane@acme.example,+1 415 555 0134\n';
  const file = path.join(f.home, 'customers.csv');
  fs.writeFileSync(file, csv);
  f.respond({ dryRun: true, accounts: [{ name: 'Acme', status: 'new' }], skipped: [] });
  const preview = await f.run(['accounts', 'import', file, '--dry-run', '--enroll', 'template-1']);
  assert.equal(preview.code, 0, preview.stderr);
  assert.deepEqual(f.requests.at(-1), { method: 'POST', url: '/api/cli/v1/accounts/import', body: { csv, templateId: 'template-1', dryRun: true } });
  f.respond({ summary: { accountsCreated: 1, accountsFailed: 0, contactsFailed: 0 }, accounts: [], skipped: [] });
  const imported = await f.run(['accounts', 'import', file]);
  assert.equal(imported.code, 0, imported.stderr);
  assert.deepEqual(f.requests.at(-1).body, { csv });
  await rejectsBeforeRequest(f, ['accounts', 'import', file, '--enroll', '../send']);
});

test('partial account and import failures retain complete JSON and exit nonzero without retry', async t => {
  const f = await fixture(t);
  const file = path.join(f.home, 'customers.csv');
  fs.writeFileSync(file, 'Company,Domain\nAcme,acme.example\n');
  const detail = 'Failure detail. '.repeat(16_384);
  for (const [args, result] of [
    [['accounts', 'create', '--name', 'Acme', '--context', 'Briefing'], { _id: 'account-1', contextError: detail }],
    [['accounts', 'update', 'account-1', '--context', 'Briefing'], { _id: 'account-1', contextError: detail }],
    [['accounts', 'import', file], { summary: { accountsFailed: 1, contactsFailed: 0 }, accounts: [{ status: 'failed', error: detail }] }],
    [['accounts', 'import', file], { summary: { accountsFailed: 0, contactsFailed: 1 }, accounts: [{ contacts: [{ status: 'failed', error: detail }] }] }],
    [['accounts', 'import', file, '--enroll', 'template-1'], { summary: { accountsFailed: 0, contactsFailed: 0 }, accounts: [], enrollment: { templateId: 'template-1', error: detail } }],
  ]) {
    f.respond(result);
    const before = f.requests.length;
    const actual = await f.run(args);
    assert.notEqual(actual.code, 0, JSON.stringify(args));
    assert.deepEqual(JSON.parse(actual.stdout), result);
    assert.equal(f.requests.length, before + 1);
  }
});

test('phone fields work in contact create, update, clearing and JSON batches', async t => {
  const f = await fixture(t);
  const created = await f.run(['contacts', 'create', '--account-id', 'account-1', '--name', 'Jane', '--email', 'jane@acme.example', '--phone', '+1 415 555 0134']);
  assert.equal(created.code, 0, created.stderr);
  assert.equal(f.requests.at(-1).body.phone, '+1 415 555 0134');
  for (const phone of ['+1 212 555 0100', '']) {
    const updated = await f.run(['contacts', 'update', 'contact-1', '--phone', phone]);
    assert.equal(updated.code, 0, updated.stderr);
    assert.deepEqual(f.requests.at(-1).body, { phone });
  }
  const file = path.join(f.home, 'contacts.json');
  const rows = [{ name: 'Jane', email: 'jane@acme.example', phone: '+1 415 555 0134' }];
  fs.writeFileSync(file, JSON.stringify(rows));
  assert.equal((await f.run(['contacts', 'create-batch', '--account-id', 'account-1', '--input-file', file])).code, 0);
  assert.deepEqual(f.requests.at(-1).body.contacts, rows);
});

test('template starters, product, duration and channel are forwarded without requiring a custom opening', async t => {
  const f = await fixture(t);
  f.respond([{ id: 'roi-stories', title: 'ROI stories' }]);
  const starters = await f.run(['story-templates', 'starters']);
  assert.equal(starters.code, 0, starters.stderr);
  assert.equal(f.requests.at(-1).url, '/api/cli/v1/story-templates/starters');
  f.respond({ _id: 'template-1' });
  const created = await f.run(['story-templates', 'create', '--starter', 'roi-stories', '--product', 'Pointed', '--interview-length', 'quick', '--interview-channel', 'phone', '--title', 'Custom ROI title']);
  assert.equal(created.code, 0, created.stderr);
  assert.deepEqual(f.requests.at(-1).body, { starter: 'roi-stories', productName: 'Pointed', interviewLength: 'quick', interviewChannel: 'phone', title: 'Custom ROI title' });
  for (const channel of ['browser_video', 'participant_choice']) {
    const video = await f.run(['story-templates', 'create', '--starter', 'roi-stories', '--interview-channel', channel]);
    assert.equal(video.code, 0, video.stderr);
    assert.equal(f.requests.at(-1).body.interviewChannel, channel);
  }
  const custom = await f.run(['story-templates', 'create', '--title', 'Renewal', '--goal', 'Learn what changed']);
  assert.equal(custom.code, 0, custom.stderr);
  assert.deepEqual(f.requests.at(-1).body, { title: 'Renewal', goal: 'Learn what changed' });
  for (const extra of [[], ['--starter', 'roi-stories', '--max-rounds', '2garbage'], ['--starter', 'roi-stories', '--interview-length', 'long'], ['--starter', 'roi-stories', '--interview-channel', 'fallback']]) {
    await rejectsBeforeRequest(f, ['story-templates', 'create', ...extra]);
  }
});

test('whole-account enrollment validates scope before listing or enrolling accounts', async t => {
  const f = await fixture(t);
  const base = ['story-templates', 'enroll', 'template-1'];
  for (const extra of [
    ['--all-accounts', '--account-ids', 'account-1'],
    ['--all-accounts', '--account-id', 'account-1'],
    ['--all-accounts', '--contact-ids', 'contact-1'],
    ['--account-ids', ''], ['--account-ids', 'account-1,'], ['--account-ids', '../send'],
    ['--all-accounts', '--data', '{"contactEmails":["jane@acme.example"]}'],
    ['--account-ids', 'account-1', '--data', '{"selections":[{"accountId":"account-2"}]}'],
  ]) await rejectsBeforeRequest(f, [...base, ...extra]);
  await rejectsBeforeRequest(f, ['story-templates', 'enroll', '../send', '--all-accounts']);
  const selected = await f.run([...base, '--account-ids', 'account-1, account-2', '--auto-include-new-contacts']);
  assert.equal(selected.code, 0, selected.stderr);
  assert.deepEqual(f.requests.at(-1).body, { selections: [{ accountId: 'account-1', autoIncludeNewContacts: true }, { accountId: 'account-2', autoIncludeNewContacts: true }], autoIncludeNewContacts: true });
  f.respond([{ _id: 'account-1' }, { _id: 'account-2' }]);
  const before = f.requests.length;
  const all = await f.run([...base, '--all-accounts']);
  assert.equal(all.code, 0, all.stderr);
  assert.deepEqual(f.requests.slice(before).map(r => [r.method, r.url]), [['GET', '/api/cli/v1/accounts'], ['POST', '/api/cli/v1/story-templates/template-1/enroll']]);
  assert.deepEqual(f.requests.at(-1).body, { selections: [{ accountId: 'account-1' }, { accountId: 'account-2' }] });
  f.respond([]);
  const empty = await f.run([...base, '--all-accounts']);
  assert.notEqual(empty.code, 0);
  assert.equal(f.requests.at(-1).method, 'GET');
});

test('enrollment distinguishes inherited auto-add from explicit opt-in and opt-out', async t => {
  const f = await fixture(t);
  const base = ['story-templates', 'enroll', 'template-1'];
  for (const selectors of [['--account-id', 'account-1'], ['--account-ids', 'account-1,account-2']]) {
    for (const [flag, expected] of [[null, undefined], ['--auto-include-new-contacts', true], ['--no-auto-include-new-contacts', false]]) {
      const result = await f.run([...base, ...selectors, ...(flag ? [flag] : [])]);
      assert.equal(result.code, 0, result.stderr);
      const body = f.requests.at(-1).body;
      for (const selection of body.selections ?? [body]) {
        assert.equal(selection.autoIncludeNewContacts, expected);
        assert.equal(Object.hasOwn(selection, 'autoIncludeNewContacts'), expected !== undefined);
      }
    }
  }
});
