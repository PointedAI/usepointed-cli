import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { startCallbackServer } from '../dist/lib/oauth-callback-server.js';
import { createPrivateExportDirectory, writePrivateExport } from '../dist/lib/private-files.js';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const hostile = '\x1b[2J\x1b]52;c;YXR0YWNr\x07\r\nFAKE SUCCESS\u009b31m\u202e';
const controls = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pointed-cli-test-'));
  fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return fs.realpathSync(dir);
}

function child(args, home, env = {}) {
  return new Promise((resolve, reject) => {
    const run = spawn(process.execPath, args, { env: { ...process.env, HOME: home, POINTED_API_KEY: '', POINTED_API_URL: '', POINTED_OUTPUT_FORMAT: 'json', ...env } });
    let stdout = '', stderr = '';
    run.stdout.on('data', data => stdout += data);
    run.stderr.on('data', data => stderr += data);
    run.on('error', reject);
    run.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function moduleCode(name, operation) {
  return ['--input-type=module', '-e', `import * as m from ${JSON.stringify(pathToFileURL(path.join(dist, 'lib', name + '.js')).href)}; ${operation}`];
}

async function api(t, response) {
  let count = 0;
  const server = http.createServer((req, res) => {
    count++;
    const value = response(req);
    res.writeHead(value.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value.body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { url: `http://127.0.0.1:${server.address().port}`, count: () => count };
}

function bundle() {
  return {
    exportVersion: 1, exportedAt: '2026-10-02',
    response: { _id: 'response-1', createdAt: 0, status: 'completed', currentRound: 1, aiSummary: 'Private summary', sentimentScore: 1, completedAt: 1 },
    contact: { name: 'Customer', email: 'private@example.com', title: null },
    campaign: { _id: 'campaign-1', title: 'Campaign', description: null, initialQuestion: 'Private question', maxRounds: 1, status: 'completed' },
    rounds: [{ roundNumber: 1, questionText: 'Private question', transcript: 'Private transcript' }],
    insights: { available: true, executiveSummary: 'Private insight' },
    manifest: { processingWarnings: [hostile] },
  };
}

async function exportFixture(t, mutate = () => {}) {
  const home = temporary(t), output = path.join(home, 'exports');
  const data = { bundle: bundle(), downloads: { videos: [] } };
  const server = await api(t, req => req.url.endsWith('/responses/response-1/export')
    ? { body: { data } }
    : { body: { data: { campaign: data.bundle.campaign, totalResponses: 1, responses: [data.bundle] } } });
  data.downloads.videos = [{ roundNumber: 1, fileName: 'round-1.mp4', status: 'ready', url: `${server.url}/video`, reason: null }];
  mutate(data);
  return { home, output, data, run: (single = true) => child([cli, 'responses', 'download', '--campaign-id', 'campaign-1', ...(single ? ['--response-id', 'response-1'] : []), '--output-dir', output], home,
    { POINTED_API_URL: server.url, POINTED_API_KEY: 'fixture-key' }) };
}

function assertPrivateTree(directory) {
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name), stat = fs.lstatSync(file);
    assert.equal(stat.isSymbolicLink(), false);
    if (stat.isDirectory()) assertPrivateTree(file);
    else assert.equal(stat.mode & 0o777, 0o600, name);
  }
}

test('single and campaign exports are private under a permissive umask and never overwrite old exports', async t => {
  const f = await exportFixture(t);
  const previous = process.umask(0o022);
  t.after(() => process.umask(previous));
  for (const single of [true, true, false]) {
    const result = await f.run(single);
    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stderr, controls);
  }
  assertPrivateTree(f.output);
  const entries = fs.readdirSync(f.output);
  assert.equal(entries.length, 3);
  const responseDir = path.join(f.output, entries.find(name => name.startsWith('response-')));
  assert.equal(fs.readFileSync(path.join(responseDir, 'ai-summary.txt'), 'utf8'), 'Private summary');
  assert.ok(fs.existsSync(path.join(responseDir, 'round-1.mp4')));
});

test('planted deterministic export paths cannot redirect writes and unsafe output roots fail closed', async t => {
  const f = await exportFixture(t);
  fs.mkdirSync(f.output, { mode: 0o700 });
  const victim = path.join(f.home, 'victim'); fs.mkdirSync(victim, { mode: 0o700 });
  fs.writeFileSync(path.join(victim, 'response.json'), 'original', { mode: 0o600 });
  fs.symlinkSync(victim, path.join(f.output, 'response-customer-1970-01-01-response-1'));
  fs.symlinkSync(victim, path.join(f.output, 'campaign-campaign'));
  assert.equal((await f.run()).code, 0);
  assert.equal((await f.run(false)).code, 0);
  assert.equal(fs.readFileSync(path.join(victim, 'response.json'), 'utf8'), 'original');
  assert.deepEqual(fs.readdirSync(victim), ['response.json']);
  fs.chmodSync(f.output, 0o777);
  assert.notEqual((await f.run()).code, 0);
  fs.rmSync(f.output, { recursive: true }); fs.symlinkSync(victim, f.output);
  assert.notEqual((await f.run()).code, 0);
  assert.deepEqual(fs.readdirSync(victim), ['response.json']);
});

test('API-derived video paths and response identifiers cannot escape a fresh export tree', async t => {
  const f = await exportFixture(t, data => {
    data.bundle.response._id = '../../../outside';
    data.downloads.videos[0].fileName = '../victim.txt';
  });
  const victim = path.join(f.output, 'victim.txt'); fs.mkdirSync(f.output, { mode: 0o700 }); fs.writeFileSync(victim, 'original', { mode: 0o600 });
  const result = await f.run();
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /Invalid export file name/);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'original');
  assert.equal(fs.existsSync(path.join(f.home, 'outside')), false);
});

test('state is private on first save and unsafe existing paths block reads, writes and logout', async t => {
  const home = temporary(t), state = path.join(home, '.pointed'), credentials = path.join(state, 'credentials.json');
  const save = moduleCode('auth-store', `m.saveCredentials({accessToken:'secret',refreshToken:'refresh',expiresAt:Date.now()+100000,tokenType:'oauth'})`);
  const load = moduleCode('auth-store', 'console.log(m.loadCredentials())');
  const clear = moduleCode('auth-store', 'm.clearCredentials()');
  assert.equal((await child(save, home)).code, 0);
  assertPrivateTree(state);
  fs.chmodSync(credentials, 0o644);
  for (const operation of [load, save, clear]) assert.notEqual((await child(operation, home)).code, 0);
  fs.chmodSync(credentials, 0o600);
  const target = path.join(home, 'outside'); fs.renameSync(credentials, target); fs.symlinkSync(target, credentials);
  for (const operation of [load, save, clear]) assert.notEqual((await child(operation, home)).code, 0);
  assert.match(fs.readFileSync(target, 'utf8'), /secret/);
  fs.unlinkSync(credentials); fs.linkSync(target, credentials);
  for (const operation of [load, save, clear]) assert.notEqual((await child(operation, home)).code, 0);
  fs.unlinkSync(credentials); fs.mkdirSync(credentials);
  for (const operation of [load, save, clear]) assert.notEqual((await child(operation, home)).code, 0);
  fs.rmSync(state, { recursive: true }); fs.mkdirSync(state, { mode: 0o755 });
  for (const operation of [load, save, clear]) assert.notEqual((await child(operation, home)).code, 0);
  fs.rmSync(state, { recursive: true }); fs.symlinkSync(home, state);
  for (const operation of [load, save, clear]) assert.notEqual((await child(operation, home)).code, 0);
});

test('unsafe config cannot redirect an authenticated request and normal atomic saves still work', async t => {
  const home = temporary(t), state = path.join(home, '.pointed'); fs.mkdirSync(state, { mode: 0o700 });
  const server = await api(t, () => ({ body: { data: [] } }));
  const target = path.join(home, 'redirect.json'); fs.writeFileSync(target, JSON.stringify({ apiBaseUrl: server.url }), { mode: 0o600 });
  fs.symlinkSync(target, path.join(state, 'config.json'));
  const request = moduleCode('api-client', `await m.apiRequest('GET','/accounts')`);
  assert.notEqual((await child(request, home, { POINTED_API_KEY: 'fixture-key' })).code, 0);
  assert.equal(server.count(), 0);
  const save = moduleCode('config', `m.saveConfig({apiBaseUrl:'https://app.usepointed.ai',defaultFormat:'json'})`);
  assert.notEqual((await child(save, home)).code, 0);
  fs.unlinkSync(path.join(state, 'config.json'));
  for (let i = 0; i < 2; i++) assert.equal((await child(save, home)).code, 0);
  assertPrivateTree(state);
  assert.deepEqual(fs.readdirSync(state), ['config.json']);
});

test('OAuth ignores malformed and unauthenticated callbacks until the matching transaction arrives', async t => {
  const { server, result } = await startCallbackServer(0, 'expected-state');
  t.after(() => { server.closeAllConnections(); server.close(); });
  let settled = false; void result.then(() => settled = true, () => settled = true);
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [url, method] of [
    ['/callback?code=bad&state=wrong', 'GET'], ['/callback?error=denied', 'GET'],
    ['/callback?state=expected-state', 'GET'], ['/callback?state=expected-state&error=', 'GET'],
    ['/callback?state=expected-state&state=expected-state&code=bad', 'GET'],
    ['/callback?state=expected-state&code=bad&code=extra', 'GET'],
    ['/callback-more?state=expected-state&code=bad', 'GET'], ['/callback?state=expected-state&code=bad', 'POST'],
  ]) {
    const response = await fetch(base + url, { method }); await response.text();
    assert.ok(response.status >= 400); assert.equal(settled, false);
  }
  const malformed = await new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: server.address().port, path: 'http://[invalid/callback' }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject); request.end();
  });
  assert.equal(malformed, 400); assert.equal(settled, false);
  const response = await fetch(base + '/callback?state=expected-state&code=original-code');
  assert.equal(response.status, 200); await response.text();
  assert.deepEqual(await result, { code: 'original-code', state: 'expected-state' });
});

test('OAuth accepts a matching-state provider denial and terminal rendering encodes its controls', async t => {
  const { server, result } = await startCallbackServer(0, 'expected-state');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const outcome = result.then(value => ({ value }), error => ({ error }));
  const params = new URLSearchParams({ state: 'expected-state', error: 'access_denied', error_description: hostile });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/callback?${params}`); await response.text();
  assert.equal(response.status, 400);
  const { error } = await outcome;
  assert.match(error.message, /access_denied/);
  const printed = await child(moduleCode('output', `m.printError(${JSON.stringify(error.message)})`), temporary(t));
  assert.doesNotMatch(printed.stderr, controls);
  assert.match(printed.stderr, /\\u001b/);
  assert.match(printed.stderr, /\\u000aFAKE SUCCESS/);
});

test('server errors and table output cannot execute controls while JSON round-trips the original data', async t => {
  const home = temporary(t), server = await api(t, () => ({ status: 400, body: { error: hostile } }));
  const result = await child([cli, 'accounts', 'list'], home, { POINTED_API_URL: server.url, POINTED_API_KEY: 'fixture-key' });
  assert.equal(result.code, 1); assert.doesNotMatch(result.stderr, controls); assert.match(result.stderr, /\\u001b/);
  for (const data of [hostile, [{ name: hostile }], { [hostile]: hostile }]) {
    const code = moduleCode('output', `m.printJson(${JSON.stringify(data)})`);
    const table = await child(code, home, { POINTED_OUTPUT_FORMAT: 'table' });
    assert.equal(table.code, 0); assert.doesNotMatch(table.stdout, controls);
    const json = await child(code, home);
    assert.doesNotMatch(json.stdout, controls);
    assert.deepEqual(JSON.parse(json.stdout), data);
  }
});

test('canonical export paths stay inside the trusted directory when a lexical alias is swapped', t => {
  const home = temporary(t), shared = path.join(home, 'shared'), trusted = path.join(home, 'trusted'), decoy = path.join(home, 'decoy');
  for (const directory of [shared, trusted, decoy]) fs.mkdirSync(directory, { mode: 0o700 });
  fs.chmodSync(shared, 0o777);
  for (const directory of [trusted, decoy]) fs.mkdirSync(path.join(directory, 'exports'), { mode: 0o700 });
  const alias = path.join(shared, 'alias'); fs.symlinkSync(trusted, alias);
  const original = fs.mkdtempSync;
  t.mock.method(fs, 'mkdtempSync', (prefix, options) => {
    fs.unlinkSync(alias); fs.symlinkSync(decoy, alias);
    return original(prefix, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const directory = createPrivateExportDirectory(path.join(alias, 'exports'), 'response');
  writePrivateExport(path.join(directory, 'response.json'), 'private');
  assert.ok(directory.startsWith(path.join(trusted, 'exports') + path.sep));
  assert.deepEqual(fs.readdirSync(path.join(decoy, 'exports')), []);
  assert.equal(fs.readFileSync(path.join(directory, 'response.json'), 'utf8'), 'private');
});

test('exclusive artifact creation refuses symlinks, hard links and existing regular files', t => {
  const home = temporary(t), directory = createPrivateExportDirectory(home, 'response');
  const target = path.join(home, 'victim'); fs.writeFileSync(target, 'original', { mode: 0o600 });
  for (const kind of ['symlink', 'hardlink', 'regular']) {
    const artifact = path.join(directory, kind);
    if (kind === 'symlink') fs.symlinkSync(target, artifact);
    else if (kind === 'hardlink') fs.linkSync(target, artifact);
    else fs.writeFileSync(artifact, 'existing', { mode: 0o600 });
    assert.throws(() => writePrivateExport(artifact, 'private'));
    assert.equal(fs.readFileSync(target, 'utf8'), 'original');
  }
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    assert.throws(() => createPrivateExportDirectory(path.parse(home).root, 'response'), /owned/);
  }
});

test('local credential writes fail closed when the platform cannot verify ownership', async t => {
  const home = temporary(t);
  const result = await child(moduleCode('auth-store', `Object.defineProperty(process, 'getuid', { value: undefined }); m.saveCredentials({accessToken:'secret',refreshToken:'refresh',expiresAt:Date.now()+100000,tokenType:'oauth'})`), home);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /POSIX ownership/);
  assert.equal(fs.existsSync(path.join(home, '.pointed', 'credentials.json')), false);
});
