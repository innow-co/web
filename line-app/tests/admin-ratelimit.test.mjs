// Own file: this test locks out the shared test IP for admin login, so it runs on its own fresh server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, stop, call, adminLogin, d1 } from './api.helper.mjs';

before(async () => { await start(); });
after(async () => { await stop(); });

test('parallel wrong admin passwords: at most 10 are evaluated, the rest are 429', async () => {
  d1('DELETE FROM attempts');
  const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => call('POST', '/api/admin/login', { json: { password: 'par-wrong-' + i } })));
  const non429 = rs.filter((r) => r.status !== 429).length;
  assert.ok(non429 <= 10, 'got ' + non429 + ' non-429');
  assert.equal(rs.filter((r) => r.status === 401).length, non429);
  d1('DELETE FROM attempts');
});

test('global cap: 50 failures per 10 minutes across all IPs, then even a fresh IP is 429', async () => {
  d1('DELETE FROM attempts');
  const hdr = (n) => ({ 'cf-connecting-ip': '203.0.113.' + n });
  const statuses = [];
  for (let n = 1; n <= 60; n++) {
    // one failure per distinct IP, in small parallel groups
    statuses.push(call('POST', '/api/admin/login', { json: { password: 'g-wrong' }, headers: hdr(n) }));
    if (n % 10 === 0) await Promise.all(statuses);
  }
  const rs = await Promise.all(statuses);
  const non429 = rs.filter((r) => r.status !== 429).length;
  assert.ok(non429 <= 50, 'got ' + non429 + ' non-429');
  assert.ok(non429 >= 40, 'IP header must be honoured by the harness, got ' + non429);
  const fresh = await call('POST', '/api/admin/login', { json: { password: 'g-wrong' }, headers: hdr(200) });
  assert.equal(fresh.status, 429);
  d1('DELETE FROM attempts');
});

test('11th wrong admin password from one IP is 429, even with the right password', async () => {
  d1('DELETE FROM attempts');
  for (let i = 0; i < 10; i++) {
    const r = await call('POST', '/api/admin/login', { json: { password: 'wrong-' + i } });
    assert.equal(r.status, 401, 'attempt ' + (i + 1));
  }
  const r = await call('POST', '/api/admin/login', { json: { password: 'wrong-11' } });
  assert.equal(r.status, 429);
  await assert.rejects(adminLogin(), /429/);
});
