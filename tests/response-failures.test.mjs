import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));

function bundle(id) {
  return {
    exportVersion: 1, exportedAt: '2026-10-04',
    response: { _id: id, createdAt: 0, status: 'completed', currentRound: 1, aiSummary: null, sentimentScore: null, completedAt: 1 },
    contact: { name: 'Customer', email: 'customer@example.com', title: null },
    campaign: { _id: 'campaign-1', title: 'Campaign', description: null, initialQuestion: 'Question', maxRounds: 1, status: 'completed' },
    rounds: [{ roundNumber: 1, questionText: 'Question', transcript: 'Saved transcript', transcriptionStatus: 'completed', videoStatus: 'ready' }],
    insights: { available: false },
    manifest: { totalRounds: 1, roundsWithTranscript: 1, roundsWithVideo: 1, processingWarnings: [] },
  };
}

async function fixture(t, { ids = ['response-1'], failures = {}, videos = [], videoFailure } = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pointed-response-test-')));
  fs.chmodSync(home, 0o700);
  const output = path.join(home, 'exports');
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const bundles = ids.map(bundle), requests = [];
  let base;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push(url.pathname);
    if (url.pathname === '/video') {
      if (videoFailure === 'network') { res.destroy(); return; }
      res.writeHead(videoFailure === 'http' ? 503 : 200, { 'content-type': 'video/mp4' });
      res.end('video bytes');
      return;
    }
    const id = url.pathname.match(/\/responses\/([^/]+)\/export$/)?.[1];
    const failure = failures[id];
    res.writeHead(failure === 'http' ? 503 : 200, { 'content-type': 'application/json' });
    if (failure === 'http') res.end(JSON.stringify({ error: `Unavailable ${id}` }));
    else if (failure === 'missing') res.end(JSON.stringify({ data: null }));
    else if (id) res.end(JSON.stringify({ data: {
      bundle: bundles.find(entry => entry.response._id === id),
      downloads: { videos: videos.map(video => ({ url: `${base}/video`, reason: null, ...video })) },
    } }));
    else res.end(JSON.stringify({ data: { campaign: bundles[0].campaign, totalResponses: bundles.length, responses: bundles } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  return {
    output, requests,
    run: (singleId) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, 'responses', 'download', '--campaign-id', 'campaign-1',
        ...(singleId !== undefined ? ['--response-id', singleId] : []), '--output-dir', output], {
        env: { ...process.env, HOME: home, POINTED_API_URL: base, POINTED_API_KEY: 'fixture-key', POINTED_OUTPUT_FORMAT: 'json' },
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', data => stdout += data);
      child.stderr.on('data', data => stderr += data);
      child.on('error', reject);
      child.on('close', code => resolve({ code, stdout, stderr }));
    }),
  };
}

function onlyDirectory(parent) {
  const directories = fs.readdirSync(parent).filter(name => fs.statSync(path.join(parent, name)).isDirectory());
  assert.equal(directories.length, 1);
  return path.join(parent, directories[0]);
}

function manifest(directory) {
  return JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
}

test('campaign response failures return nonzero and record all failed response IDs durably', async t => {
  const f = await fixture(t, { ids: ['response-1', 'response-2'], failures: { 'response-1': 'http', 'response-2': 'missing' } });
  const result = await f.run();
  assert.equal(result.code, 1, result.stderr);
  assert.doesNotMatch(result.stdout, /Exported/);
  assert.match(result.stderr, /Exported 0 of 2/);
  const campaignDir = onlyDirectory(f.output);
  const saved = manifest(campaignDir);
  assert.equal(saved.totalResponses, 2);
  assert.equal(saved.exportedResponses, 0);
  assert.equal(saved.failedResponses, 2);
  assert.deepEqual(saved.responses.map(response => [response.responseId, response.status]), [
    ['response-1', 'failed'], ['response-2', 'failed'],
  ]);
  assert.match(saved.responses[0].warnings[0], /Unavailable response-1/);
  assert.match(saved.responses[1].warnings[0], /Failed to load downloadable assets/);
});

test('partial campaign failures preserve successful exports and keep processing later responses', async t => {
  const f = await fixture(t, { ids: ['response-1', 'response-2', 'response-3'], failures: { 'response-2': 'http' } });
  const result = await f.run();
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /Exported 2 of 3/);
  const campaignDir = onlyDirectory(f.output), saved = manifest(campaignDir);
  assert.equal(saved.exportedResponses, 2);
  assert.equal(saved.failedResponses, 1);
  assert.deepEqual(saved.responses.map(response => response.status), ['exported', 'failed', 'exported']);
  for (const response of saved.responses.filter(response => response.status === 'exported')) {
    const directory = path.join(campaignDir, response.directory);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'response.json'), 'utf8')).response._id, response.responseId);
    assert.match(fs.readFileSync(path.join(directory, 'round-1-transcript.txt'), 'utf8'), /Saved transcript/);
    assert.deepEqual(manifest(directory).processingWarnings, []);
  }
});

test('single response HTTP or missing-payload failures return nonzero', async t => {
  for (const failure of ['http', 'missing']) {
    const f = await fixture(t, { failures: { 'response-1': failure } });
    const result = await f.run('response-1');
    assert.equal(result.code, 1, result.stderr);
    assert.doesNotMatch(result.stdout, /Exported/);
    assert.equal(fs.existsSync(f.output), false);
  }
});

test('ready video HTTP and network failures are saved in the final manifest and fail the command', async t => {
  for (const videoFailure of ['http', 'network']) {
    const f = await fixture(t, { videos: [{ roundNumber: 1, fileName: 'round-1.mp4', status: 'ready' }], videoFailure });
    const result = await f.run('response-1');
    assert.equal(result.code, 1, result.stderr);
    assert.doesNotMatch(result.stdout, /Exported/);
    assert.match(result.stderr, /Response export is incomplete/);
    const directory = onlyDirectory(f.output), saved = manifest(directory);
    assert.equal(saved.videoDownloads[0].status, 'failed');
    assert.match(saved.videoDownloads[0].reason, videoFailure === 'http' ? /status 503/ : /fetch failed/);
    assert.match(saved.processingWarnings[0], /Round 1:/);
    assert.ok(fs.existsSync(path.join(directory, 'response.json')));
    assert.ok(fs.existsSync(path.join(directory, 'round-1-transcript.txt')));
    assert.equal(fs.existsSync(path.join(directory, 'round-1.mp4')), false);
  }
});

test('campaign ready-video failures mark partial responses and preserve their local files', async t => {
  const f = await fixture(t, { videos: [{ roundNumber: 1, fileName: 'round-1.mp4', status: 'ready' }], videoFailure: 'http' });
  const result = await f.run();
  assert.equal(result.code, 1, result.stderr);
  const campaignDir = onlyDirectory(f.output), saved = manifest(campaignDir);
  assert.equal(saved.exportedResponses, 0);
  assert.equal(saved.failedResponses, 1);
  assert.equal(saved.responses[0].status, 'partial');
  assert.match(saved.responses[0].warnings[0], /status 503/);
  const directory = path.join(campaignDir, saved.responses[0].directory);
  assert.equal(manifest(directory).videoDownloads[0].status, 'failed');
  assert.ok(fs.existsSync(path.join(directory, 'response.json')));
});

test('local video write failures preserve bundle files and final manifest diagnostics', async t => {
  for (const fileName of ['response.json', 'manifest.json', '../outside.mp4']) {
    const f = await fixture(t, { videos: [{ roundNumber: 1, fileName, status: 'ready' }] });
    const result = await f.run('response-1');
    assert.equal(result.code, 1, result.stderr);
    const directory = onlyDirectory(f.output), saved = manifest(directory);
    assert.equal(saved.videoDownloads[0].status, 'failed');
    assert.equal(saved.videoDownloads[0].fileName, fileName);
    assert.equal(saved.processingWarnings.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'response.json'), 'utf8')).response._id, 'response-1');
    assert.equal(fs.existsSync(path.join(f.output, 'outside.mp4')), false);
  }
});

test('preparing and unavailable media remain nonfatal with durable warnings and downloaded results', async t => {
  for (const single of [true, false]) {
    const f = await fixture(t, { videos: [
      { roundNumber: 1, fileName: 'round-1.mp4', status: 'preparing', reason: 'Media is processing' },
      { roundNumber: 2, fileName: 'round-2.mp4', status: 'unavailable', reason: 'No recording' },
      { roundNumber: 3, fileName: 'round-3.mp4', status: 'ready', url: null },
      { roundNumber: 4, fileName: 'round-4.mp4', status: 'ready' },
    ] });
    const result = await f.run(single ? 'response-1' : undefined);
    assert.equal(result.code, 0, result.stderr);
    const root = onlyDirectory(f.output), directory = single ? root : onlyDirectory(root);
    const saved = manifest(directory);
    assert.equal(saved.processingWarnings.length, 3);
    assert.deepEqual(saved.videoDownloads.map(video => video.status), ['preparing', 'unavailable', 'unavailable', 'downloaded']);
    assert.equal(fs.readFileSync(path.join(directory, 'round-4.mp4'), 'utf8'), 'video bytes');
    assert.equal(f.requests.filter(request => request === '/video').length, 1);
    if (!single) {
      assert.equal(manifest(root).exportedResponses, 1);
      assert.equal(manifest(root).failedResponses, 0);
    }
  }
});

test('API-derived malicious response IDs cannot redirect campaign detail requests', async t => {
  const maliciousId = '../invite-1/email/send?ignored=';
  const f = await fixture(t, { ids: [maliciousId] });
  const result = await f.run();
  assert.equal(result.code, 1, result.stderr);
  assert.deepEqual(f.requests, ['/api/cli/v1/campaigns/campaign-1/export']);
  const saved = manifest(onlyDirectory(f.output));
  assert.equal(saved.responses[0].responseId, maliciousId);
  assert.equal(saved.responses[0].status, 'failed');
});
