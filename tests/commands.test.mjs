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
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    requests.push({ method: request.method, url: request.url, body: raw ? JSON.parse(raw) : undefined });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: result }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return {
    home,
    requests,
    respond(value) { result = value; },
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
