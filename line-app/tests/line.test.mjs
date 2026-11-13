import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyLineWithFetch, isLocalHost } from '../src/line.js';

const ENV = { LINE_LOGIN_CHANNEL_ID: 'chan-1' };
const TOKEN = 'abc DEF/+=0123456789';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

// Routes by URL; records every call.
function stub(overrides = {}) {
  const calls = [];
  const routes = {
    verify: () => res(200, { client_id: 'chan-1', expires_in: 3000 }),
    profile: () => res(200, { userId: 'U123', displayName: 'Somchai', pictureUrl: 'https://p/x.png' }),
    friend: () => res(200, { friendFlag: true }),
    ...overrides,
  };
  const f = async (url, init) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.startsWith('https://api.line.me/oauth2/v2.1/verify')) return routes.verify();
    if (u === 'https://api.line.me/v2/profile') return routes.profile();
    if (u === 'https://api.line.me/friendship/v1/status') return routes.friend();
    throw new Error('unexpected url ' + u);
  };
  return { f, calls };
}
const status = (p) => p.then(() => null, (e) => e.status);

test('success returns the profile and friend flag', async () => {
  const { f } = stub();
  assert.deepEqual(await verifyLineWithFetch(TOKEN, ENV, f), { userId: 'U123', displayName: 'Somchai', pictureUrl: 'https://p/x.png', isFriend: true });
});

test('verify URL encodes the token; profile and friendship send a Bearer header', async () => {
  const { f, calls } = stub();
  await verifyLineWithFetch(TOKEN, ENV, f);
  assert.equal(calls[0].url, 'https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(TOKEN));
  const rest = calls.slice(1);
  assert.equal(rest.length, 2);
  for (const c of rest) assert.equal(c.init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.deepEqual(rest.map((c) => c.url).sort(), ['https://api.line.me/friendship/v1/status', 'https://api.line.me/v2/profile']);
});

test('wrong client_id is 401', async () => {
  const { f } = stub({ verify: () => res(200, { client_id: 'other', expires_in: 3000 }) });
  assert.equal(await status(verifyLineWithFetch(TOKEN, ENV, f)), 401);
});

test('verify response not ok is 401', async () => {
  const { f } = stub({ verify: () => res(400, { error: 'invalid_request' }) });
  assert.equal(await status(verifyLineWithFetch(TOKEN, ENV, f)), 401);
});

test('expires_in <= 0 is 401', async () => {
  for (const expires_in of [0, -5, undefined]) {
    const { f } = stub({ verify: () => res(200, { client_id: 'chan-1', expires_in }) });
    assert.equal(await status(verifyLineWithFetch(TOKEN, ENV, f)), 401, String(expires_in));
  }
});

test('profile not ok is 401', async () => {
  const { f } = stub({ profile: () => res(401, {}) });
  assert.equal(await status(verifyLineWithFetch(TOKEN, ENV, f)), 401);
});

test('friendship API failure gives isFriend:false and still succeeds', async () => {
  const { f } = stub({ friend: () => res(500, { message: 'boom' }) });
  const r = await verifyLineWithFetch(TOKEN, ENV, f);
  assert.equal(r.isFriend, false);
  assert.equal(r.userId, 'U123');
});

test('friendFlag false and a missing flag are not friends', async () => {
  for (const body of [{ friendFlag: false }, {}]) {
    const { f } = stub({ friend: () => res(200, body) });
    assert.equal((await verifyLineWithFetch(TOKEN, ENV, f)).isFriend, false);
  }
});

test('blank or missing LINE_LOGIN_CHANNEL_ID is 503 and LINE is never called', async () => {
  for (const env of [{}, { LINE_LOGIN_CHANNEL_ID: '' }, { LINE_LOGIN_CHANNEL_ID: '   ' }]) {
    const { f, calls } = stub();
    assert.equal(await status(verifyLineWithFetch(TOKEN, env, f)), 503, JSON.stringify(env));
    assert.equal(calls.length, 0);
  }
});

test('non-string or short access token is 401 without calling LINE', async () => {
  for (const t of [undefined, null, 12345678901, {}, ['abcdefghijkl'], '', 'short', '123456789']) {
    const { f, calls } = stub();
    assert.equal(await status(verifyLineWithFetch(t, ENV, f)), 401, String(t));
    assert.equal(calls.length, 0);
  }
});

test('isLocalHost accepts only loopback names', () => {
  for (const h of ['localhost', '127.0.0.1', '[::1]', 'LOCALHOST']) assert.equal(isLocalHost(h), true, h);
  for (const h of ['innow-line.example.workers.dev', 'example.com', 'localhost.evil.com', '127.0.0.1.evil.com', '127.0.0.2', '', undefined, null, '::1x']) assert.equal(isLocalHost(h), false, String(h));
});

// ---- LINE_LOGIN_CHANNEL_ID allowlist (MINI App has three internal channels) ----
const withIds = (ids, clientId = '2012557247') => {
  const { f } = stub({ verify: () => res(200, { client_id: clientId, expires_in: 3000 }) });
  return verifyLineWithFetch(TOKEN, { LINE_LOGIN_CHANNEL_ID: ids }, f);
};

test('allowlist: a single id still works', async () => {
  assert.equal((await withIds('2012557247')).userId, 'U123');
});

test('allowlist: accepts a token whose client_id is any listed id', async () => {
  for (const id of ['2012557246', '2012557247', '2012557248']) {
    assert.equal((await withIds('2012557246,2012557247,2012557248', id)).userId, 'U123', id);
  }
});

test('allowlist: spaces and a trailing comma are tolerated', async () => {
  assert.equal((await withIds(' 2012557246 , 2012557247 ,')).userId, 'U123');
  assert.equal((await withIds('2012557247,,')).userId, 'U123');
});

test('allowlist: no match is 401', async () => {
  assert.equal(await status(withIds('2012557246,2012557248', '2012557247')), 401);
});

test('allowlist: a prefix of an id does not match, in either direction', async () => {
  assert.equal(await status(withIds('20125572', '2012557246')), 401);
  assert.equal(await status(withIds('2012557246', '20125572')), 401);
});

test('allowlist: empty, whitespace-only or commas-only value fails closed with 503', async () => {
  for (const v of ['', '   ', ' , ,', undefined]) assert.equal(await status(withIds(v)), 503, String(v));
});
