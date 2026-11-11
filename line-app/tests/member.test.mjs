import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { start, stop, call, d1, seedWorkshop, addItem, login, adminLogin, unusedCode } from './api.helper.mjs';

const norm = (m) => String(m).replace(/\d+/g, 'N');
const good = { firstName: 'สมชาย', lastName: 'ใจดี', email: 'somchai@example.com', acceptTerms: true };

before(async () => { await start(); });
after(async () => { await stop(); });

test('auth: friend gets session, no member yet', async () => {
  const r = await call('POST', '/api/auth', { json: { accessToken: 'dev:u1' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.isFriend, true);
  assert.equal(r.data.member, null);
  assert.ok(r.data.session);
});

test('auth: non-friend is told so and /api/me is 403 notFriend', async () => {
  const { token, res } = await login('nofriend1');
  assert.equal(res.data.isFriend, false);
  const me = await call('GET', '/api/me', { token });
  assert.equal(me.status, 403);
  assert.equal(me.data.notFriend, true);
});

test('garbage bearer token is 401, not 500', async () => {
  for (const t of ['abc.%%%', 'garbage', 'a.b.c']) {
    const r = await call('GET', '/api/me', { token: t });
    assert.equal(r.status, 401, t);
  }
});

test('journey: new user redeems, registers, sees workshop; second redeem path', async () => {
  const a = await seedWorkshop('Workshop A');
  const b = await seedWorkshop('Workshop B');
  const { token } = await login('journey1');

  const rd = await call('POST', '/api/redeem', { token, json: { code: a.code } });
  assert.equal(rd.status, 200);
  assert.equal(rd.data.status, 'register');
  assert.ok(rd.data.redeemToken);

  const reg = await call('POST', '/api/register', { token, json: { ...good, redeemToken: rd.data.redeemToken } });
  assert.equal(reg.status, 200);
  assert.equal(reg.data.status, 'enrolled');

  const me = await call('GET', '/api/me', { token });
  assert.equal(me.data.workshops.length, 1);
  assert.equal(me.data.workshops[0].id, a.id);
  assert.equal(me.data.member.email, good.email);

  // already a member: different workshop enrolls directly
  const rd2 = await call('POST', '/api/redeem', { token, json: { code: b.code } });
  assert.equal(rd2.data.status, 'enrolled');
  // same code again
  const rd3 = await call('POST', '/api/redeem', { token, json: { code: b.code } });
  assert.equal(rd3.data.status, 'already');
});

test('wrong codes: generic 400, sixth attempt is 429, other users unaffected', async () => {
  const { token } = await login('ratelimit1');
  const wrong = unusedCode();
  for (let i = 0; i < 5; i++) {
    const r = await call('POST', '/api/redeem', { token, json: { code: i === 0 ? 'abcd' : wrong } });
    assert.equal(r.status, 400, 'attempt ' + (i + 1));
    assert.ok(r.data.error);
  }
  const r6 = await call('POST', '/api/redeem', { token, json: { code: wrong } });
  assert.equal(r6.status, 429);
  const { token: other } = await login('ratelimit2');
  const rb = await call('POST', '/api/redeem', { token: other, json: { code: wrong } });
  assert.equal(rb.status, 400);
});

test('rate limit holds under parallel requests: 30 wrong codes from one user', async () => {
  const { token } = await login('ratelimit-par');
  const wrong = unusedCode();
  const rs = await Promise.all(Array.from({ length: 30 }, () => call('POST', '/api/redeem', { token, json: { code: wrong } })));
  const limited = rs.filter((r) => r.status === 429).length;
  const rejected = rs.filter((r) => r.status === 400).length;
  assert.ok(rejected <= 5, 'only 5 wrong codes may be evaluated, got ' + rejected);
  assert.ok(limited >= 25, 'at least 25 must be 429, got ' + limited);
  assert.equal(rejected + limited, 30);
  const { token: other } = await login('ratelimit-par-other');
  assert.equal((await call('POST', '/api/redeem', { token: other, json: { code: wrong } })).status, 400);
});

test('a successful redeem after failures is not counted as a failure', async () => {
  const w = await seedWorkshop('Success not counted');
  const { token } = await login('ratelimit-ok');
  const wrong = unusedCode();
  for (let i = 0; i < 4; i++) assert.equal((await call('POST', '/api/redeem', { token, json: { code: wrong } })).status, 400);
  assert.equal((await call('POST', '/api/redeem', { token, json: { code: w.code } })).status, 200);
  // 4 failures + 1 success: a fifth failure is still allowed, the sixth is blocked.
  assert.equal((await call('POST', '/api/redeem', { token, json: { code: wrong } })).status, 400);
  assert.equal((await call('POST', '/api/redeem', { token, json: { code: wrong } })).status, 429);
});

test('issued code is a 4-digit string', async () => {
  const w = await seedWorkshop('Format');
  assert.equal(typeof w.code, 'string');
  assert.match(w.code, /^\d{4}$/);
});

test('issuing a new code revokes the previous one', async () => {
  const w = await seedWorkshop('Rotate');
  const t = await adminLogin();
  const second = await call('POST', `/api/admin/workshops/${w.id}/codes`, { token: t, json: { minutes: 30 } });
  assert.equal(second.status, 200);
  const { token: u1 } = await login('rotate1');
  const { token: u2 } = await login('rotate2');
  const baseline = await call('POST', '/api/redeem', { token: u2, json: { code: unusedCode() } });
  assert.equal(baseline.status, 400);
  const old = await call('POST', '/api/redeem', { token: u1, json: { code: w.code } });
  assert.equal(old.status, 400);
  assert.equal(norm(old.data.error), norm(baseline.data.error));
  const fresh = await call('POST', '/api/redeem', { token: u1, json: { code: second.data.code } });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.data.status, 'register');
});

test('admin revoke makes the current code fail with the generic message', async () => {
  const w = await seedWorkshop('Revoke');
  const t = await adminLogin();
  const rv = await call('DELETE', `/api/admin/workshops/${w.id}/codes`, { token: t });
  assert.equal(rv.status, 200);
  const { token: u1 } = await login('revoke1');
  const { token: u2 } = await login('revoke2');
  const baseline = await call('POST', '/api/redeem', { token: u2, json: { code: unusedCode() } });
  const r = await call('POST', '/api/redeem', { token: u1, json: { code: w.code } });
  assert.equal(r.status, 400);
  assert.equal(norm(r.data.error), norm(baseline.data.error));
});

test('expired code gets the same generic 400 as a wrong code', async () => {
  const w = await seedWorkshop('Expiring', { minutes: 1 });
  const { token } = await login('expire1');
  const { token: t2 } = await login('expire2');
  const wrong = await call('POST', '/api/redeem', { token: t2, json: { code: unusedCode() } });
  d1(`UPDATE codes SET expires_at = 1000 WHERE workshop_id = '${w.id}'`);
  const r = await call('POST', '/api/redeem', { token, json: { code: w.code } });
  assert.equal(r.status, 400);
  assert.equal(norm(r.data.error), norm(wrong.data.error));
});

test('code 0042 is accepted when issued', async () => {
  const w = await seedWorkshop('Leading zeros');
  d1(`UPDATE codes SET code = '0042' WHERE workshop_id = '${w.id}'`);
  const { token } = await login('zero1');
  const r = await call('POST', '/api/redeem', { token, json: { code: '0042' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'register');
});

test('register without acceptTerms is 422 with errors.acceptTerms', async () => {
  const w = await seedWorkshop('Terms');
  const { token } = await login('terms1');
  const rd = await call('POST', '/api/redeem', { token, json: { code: w.code } });
  const r = await call('POST', '/api/register', { token, json: { ...good, acceptTerms: false, redeemToken: rd.data.redeemToken } });
  assert.equal(r.status, 422);
  assert.ok(r.data.errors.acceptTerms);
});

test('register twice with the same redeemToken leaves one member row', async () => {
  const w = await seedWorkshop('Twice');
  const { token } = await login('twice1');
  const rd = await call('POST', '/api/redeem', { token, json: { code: w.code } });
  const body = { ...good, redeemToken: rd.data.redeemToken };
  const [r1, r2] = await Promise.all([call('POST', '/api/register', { token, json: body }), call('POST', '/api/register', { token, json: body })]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  const out = d1("SELECT COUNT(*) AS n FROM members WHERE line_user_id = 'twice1'");
  assert.match(out, /"n": 1\b/);
  const en = d1("SELECT COUNT(*) AS n FROM enrollments WHERE line_user_id = 'twice1'");
  assert.match(en, /"n": 1\b/);
});

test('isolation: other workshop and its files are 403', async () => {
  const a = await seedWorkshop('Iso A');
  const b = await seedWorkshop('Iso B');
  const itemB = await addItem(b.id, { kind: 'slide', title: 'secret slide' });
  d1(`UPDATE items SET r2_key = 'workshops/x/none', file_name = 'x.pdf', content_type = 'application/pdf', size = 1 WHERE id = ${itemB}`);
  const { token } = await login('iso1');
  const rd = await call('POST', '/api/redeem', { token, json: { code: a.code } });
  await call('POST', '/api/register', { token, json: { ...good, redeemToken: rd.data.redeemToken } });

  assert.equal((await call('GET', `/api/workshops/${a.id}`, { token })).status, 200);
  assert.equal((await call('GET', `/api/workshops/${b.id}`, { token })).status, 403);
  assert.equal((await call('POST', `/api/items/${itemB}/link`, { token })).status, 403);
});

// Sends a request to the local server but with a different Host header (what a deployed workers.dev host looks like).
function callWithHost(host, method, p, json) {
  return new Promise((resolve, reject) => {
    const payload = json === undefined ? null : JSON.stringify(json);
    const req = http.request({ host: '127.0.0.1', port: 8799, method, path: p, headers: { host, ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; });
      res.on('end', () => { let data; try { data = JSON.parse(t); } catch { data = t; } resolve({ status: res.statusCode, data }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('dev identity bypass works on loopback hosts only', async () => {
  const local = await call('POST', '/api/auth', { json: { accessToken: 'dev:hostcheck1' } });
  assert.equal(local.status, 200);
  assert.equal((await call('GET', '/api/config')).data.dev, true);

  const publicHost = 'innow-line.example.workers.dev';
  const cfg = await callWithHost(publicHost, 'GET', '/api/config');
  assert.equal(cfg.status, 200);
  assert.equal(cfg.data.dev, false);
  const r = await callWithHost(publicHost, 'POST', '/api/auth', { accessToken: 'dev:hostcheck2' });
  assert.equal(r.status, 401);
  assert.equal(r.data.session, undefined);
});
