import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRichMenu } from '../richmenu/create.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CREATE = join(here, '..', 'richmenu', 'create.mjs');
const PNG = join(here, '..', 'richmenu', 'richmenu.png');

const FAKE_TOKEN = 'FAKE-TOKEN-do-not-leak-1234567890';

test('buildRichMenu: size, selected, chatBarText', () => {
  const m = buildRichMenu('1234-abcd', '@innow');
  assert.deepEqual(m.size, { width: 2500, height: 1686 });
  assert.equal(m.selected, true);
  assert.ok(typeof m.name === 'string' && m.name.length > 0 && m.name.length <= 300);
  assert.ok(m.chatBarText.length > 0 && m.chatBarText.length <= 14);
});

test('buildRichMenu: six areas tile the image exactly, ordered, no overlap', () => {
  const { areas } = buildRichMenu('1234-abcd', '@innow');
  assert.equal(areas.length, 6);
  let total = 0;
  for (const a of areas) {
    const b = a.bounds;
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 2500 && b.y + b.height <= 1686);
    assert.equal(b.height, 843);
    assert.ok(b.width === 833 || b.width === 834);
    total += b.width * b.height;
  }
  assert.equal(total, 2500 * 1686);
  // pairwise no overlap
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
    const p = areas[i].bounds, q = areas[j].bounds;
    const overlap = p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
    assert.equal(overlap, false, `areas ${i} and ${j} overlap`);
  }
  // left-to-right, top-to-bottom ordering
  const xs = areas.map((a) => a.bounds.x), ys = areas.map((a) => a.bounds.y);
  assert.deepEqual(xs, [0, 833, 1666, 0, 833, 1666]);
  assert.deepEqual(ys, [0, 0, 0, 843, 843, 843]);
  assert.deepEqual(areas.map((a) => a.bounds.width), [833, 833, 834, 833, 833, 834]);
});

test('buildRichMenu: actions and exact URLs', () => {
  const { areas } = buildRichMenu('1234-abcd', '@innow');
  const uris = areas.map((a) => { assert.equal(a.action.type, 'uri'); return a.action.uri; });
  // The OA basic id is URL-encoded in the oaMessage path: LINE documents the form
  // https://line.me/R/oaMessage/{URL-encoded basic ID}/ , so "@" becomes "%40".
  assert.deepEqual(uris, [
    'https://liff.line.me/1234-abcd?p=workshops',
    'https://liff.line.me/1234-abcd?p=redeem',
    'https://liff.line.me/1234-abcd?p=prompts',
    'https://liff.line.me/1234-abcd?p=bonus',
    'https://www.facebook.com/innow.co.th',
    'https://line.me/R/oaMessage/%40innow/',
  ]);
  for (const a of areas) assert.ok(a.action.label === undefined || a.action.label.length <= 20);
});

test('buildRichMenu: basic id with or without @ gives the same URL', () => {
  const a = buildRichMenu('1234-abcd', '355rjzvz').areas[5].action.uri;
  const b = buildRichMenu('1234-abcd', '@355rjzvz').areas[5].action.uri;
  assert.equal(a, b);
  assert.equal(a, 'https://line.me/R/oaMessage/%40355rjzvz/');
});

test('buildRichMenu: rejects empty or non-string inputs', () => {
  assert.throws(() => buildRichMenu('', '@innow'));
  assert.throws(() => buildRichMenu('  ', '@innow'));
  assert.throws(() => buildRichMenu('1234-abcd', ''));
  assert.throws(() => buildRichMenu('1234-abcd', '@'));
  assert.throws(() => buildRichMenu(undefined, '@innow'));
  assert.throws(() => buildRichMenu('1234-abcd', null));
});

// ---- CLI ------------------------------------------------------------------
// A preload script replaces globalThis.fetch with a recorder, so the CLI can be
// exercised without any network: every call is appended to FAKE_FETCH_LOG.
const PRELOAD = 'data:text/javascript,' + encodeURIComponent(`
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  const log = process.env.FAKE_FETCH_LOG;
  appendFileSync(log, JSON.stringify({ url: String(url), method: init.method, ct: init.headers && init.headers['Content-Type'], auth: init.headers && init.headers.Authorization }) + '\\n');
  const failOn = process.env.FAKE_FAIL_ON;
  if (failOn && String(url).includes(failOn)) {
    return new Response(JSON.stringify({ message: 'boom from line' }), { status: 400 });
  }
  if (String(url).endsWith('/v2/bot/richmenu') && init.method === 'POST') {
    return new Response(JSON.stringify({ richMenuId: 'richmenu-abc123' }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
};
`);

function runCli(args, env, withFake = true) {
  const dir = mkdtempSync(join(tmpdir(), 'rm-'));
  const log = join(dir, 'fetch.log');
  const nodeArgs = withFake ? ['--import', PRELOAD, CREATE, ...args] : [CREATE, ...args];
  const r = spawnSync(process.execPath, nodeArgs, {
    env: { PATH: process.env.PATH, FAKE_FETCH_LOG: log, ...env },
    encoding: 'utf8', timeout: 15000,
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { ...r, calls };
}

const FULL_ENV = { LINE_CHANNEL_ACCESS_TOKEN: FAKE_TOKEN, LIFF_ID: '1234-abcd', OA_BASIC_ID: '@innow' };

test('CLI: exits non-zero without env vars and makes no network call', () => {
  for (const missing of ['LINE_CHANNEL_ACCESS_TOKEN', 'LIFF_ID', 'OA_BASIC_ID']) {
    const env = { ...FULL_ENV }; delete env[missing];
    const r = runCli(['--confirm'], env);
    assert.notEqual(r.status, 0, `${missing} missing should fail`);
    assert.match(r.stderr, new RegExp(missing));
    assert.equal(r.calls.length, 0);
  }
  const r = runCli(['--confirm'], {});
  assert.notEqual(r.status, 0);
  assert.equal(r.calls.length, 0);
});

test('CLI: --dry-run prints JSON body, no network, never prints the token', () => {
  const r = runCli(['--dry-run'], FULL_ENV);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls.length, 0);
  assert.ok(!r.stdout.includes(FAKE_TOKEN) && !r.stderr.includes(FAKE_TOKEN));
  const start = r.stdout.indexOf('{'); const end = r.stdout.lastIndexOf('}');
  const body = JSON.parse(r.stdout.slice(start, end + 1));
  assert.deepEqual(body, buildRichMenu('1234-abcd', '@innow'));
  assert.match(r.stderr, /api\.line\.me\/v2\/bot\/richmenu/);
});

test('CLI: without --confirm makes no network call and asks for --confirm', () => {
  const r = runCli([], FULL_ENV);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--confirm/);
  assert.equal(r.calls.length, 0);
  assert.ok(!r.stdout.includes(FAKE_TOKEN) && !r.stderr.includes(FAKE_TOKEN));
});

test('CLI: --confirm creates, uploads PNG, sets default, prints only the id', () => {
  const r = runCli(['--confirm'], FULL_ENV);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'richmenu-abc123');
  assert.ok(!r.stderr.includes(FAKE_TOKEN));
  assert.deepEqual(r.calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.line.me/v2/bot/richmenu',
    'POST https://api-data.line.me/v2/bot/richmenu/richmenu-abc123/content',
    'POST https://api.line.me/v2/bot/user/all/richmenu/richmenu-abc123',
  ]);
  assert.equal(r.calls[1].ct, 'image/png');
  assert.equal(r.calls[0].auth, `Bearer ${FAKE_TOKEN}`);
});

test('CLI: failure after create deletes the menu and exits non-zero without the token', () => {
  const r = runCli(['--confirm'], { ...FULL_ENV, FAKE_FAIL_ON: '/content' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /boom from line/);
  assert.ok(!r.stdout.includes(FAKE_TOKEN) && !r.stderr.includes(FAKE_TOKEN));
  const last = r.calls[r.calls.length - 1];
  assert.equal(`${last.method} ${last.url}`, 'DELETE https://api.line.me/v2/bot/richmenu/richmenu-abc123');

  const r2 = runCli(['--confirm'], { ...FULL_ENV, FAKE_FAIL_ON: '/user/all/richmenu/' });
  assert.notEqual(r2.status, 0);
  const last2 = r2.calls[r2.calls.length - 1];
  assert.equal(last2.method, 'DELETE');
});

test('CLI: failure of the create call itself needs no rollback', () => {
  const r = runCli(['--confirm'], { ...FULL_ENV, FAKE_FAIL_ON: 'v2/bot/richmenu' });
  assert.notEqual(r.status, 0);
  assert.equal(r.calls.length, 1);
});

// ---- Image ------------------------------------------------------------------
test('richmenu.png is 2500 x 1686 and under 1 MB', () => {
  assert.ok(existsSync(PNG), 'run: node richmenu/render.mjs');
  const buf = readFileSync(PNG);
  assert.equal(buf.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(buf.readUInt32BE(16), 2500);
  assert.equal(buf.readUInt32BE(20), 1686);
  assert.ok(statSync(PNG).size < 1024 * 1024, `size ${statSync(PNG).size}`);
});
