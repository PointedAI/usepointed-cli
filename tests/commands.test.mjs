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
    target: { kind: 'story_template', id: 'template-1' }, actorId: 'private-internal-actor', url: 'https://app.usepointed.ai/dashboard' };
  f.respond(settings);
  const fetched = await f.run(['interviews', 'settings', 'get', 'template-1', '--kind', 'story_template']);
  assert.equal(fetched.code, 0, fetched.stderr);
  const editable = JSON.parse(fetched.stdout);
  assert.deepEqual(editable, { expectedRevision: 7, openingQuestion: settings.openingQuestion, context: settings.context, instructions: settings.instructions, elevenLabsSettingsJson: native });
  assert.equal(f.requests.at(-1).url, '/api/cli/v1/interview-settings/story_template/template-1');
  const file = path.join(f.home, 'settings.json');
  fs.writeFileSync(file, JSON.stringify(editable));
  f.respond({ status: 'saved', revision: 8 });
  const saved = await f.run(['interviews', 'settings', 'set', 'template-1', '--kind', 'story_template', '--file', file]);
  assert.equal(saved.code, 0, saved.stderr);
  assert.deepEqual(f.requests.at(-1), { method: 'PUT', url: '/api/cli/v1/interview-settings/story_template/template-1', body: editable });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), editable);
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
