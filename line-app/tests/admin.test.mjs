import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, stop, call, d1, seedWorkshop, addItem, login, adminLogin, unusedCode, BASE } from './api.helper.mjs';

const good = { firstName: 'สมชาย', lastName: 'ใจดี', email: 'somchai@example.com', acceptTerms: true };
let T;

before(async () => { await start(); T = await adminLogin(); });
after(async () => { await stop(); });

async function enroll(uid, code, reg = good) {
  const { token } = await login(uid);
  const rd = await call('POST', '/api/redeem', { token, json: { code } });
  if (rd.data.status === 'register') {
    const r = await call('POST', '/api/register', { token, json: { ...reg, redeemToken: rd.data.redeemToken } });
    assert.equal(r.status, 200);
  }
  return token;
}

test('admin routes without or with bad token are 401', async () => {
  for (const [m, p] of [['GET', '/api/admin/workshops'], ['GET', '/api/admin/members'], ['GET', '/api/admin/members.csv'],
    ['POST', '/api/admin/workshops/x/copy-from/y'], ['GET', '/api/admin/stats']]) {
    assert.equal((await call(m, p)).status, 401, p);
    assert.equal((await call(m, p, { token: 'garbage' })).status, 401, p + ' bad');
  }
});

test('wrong password is 401 and correct password gives a token', async () => {
  const r = await call('POST', '/api/admin/login', { json: { password: 'definitely-wrong' } });
  assert.equal(r.status, 401);
  assert.ok(T);
  assert.equal((await call('GET', '/api/admin/stats', { token: T })).status, 200);
});

test('workshop create, update, delete', async () => {
  const c = await call('POST', '/api/admin/workshops', { token: T, json: { title: 'CRUD WS', description: 'd' } });
  assert.equal(c.status, 200);
  const id = c.data.id;
  assert.equal((await call('POST', '/api/admin/workshops', { token: T, json: { title: '  ' } })).status, 422);
  const u = await call('PUT', `/api/admin/workshops/${id}`, { token: T, json: { title: 'CRUD WS 2', active: false } });
  assert.equal(u.status, 200);
  const list = await call('GET', '/api/admin/workshops', { token: T });
  const w = list.data.workshops.find((x) => x.id === id);
  assert.equal(w.title, 'CRUD WS 2');
  assert.equal(w.active, false);
  assert.equal((await call('PUT', '/api/admin/workshops/nope', { token: T, json: { title: 'x' } })).status, 404);
  assert.equal((await call('DELETE', `/api/admin/workshops/${id}`, { token: T })).status, 200);
  assert.ok(!(await call('GET', '/api/admin/workshops', { token: T })).data.workshops.some((x) => x.id === id));
});

test('new code revokes the previous active one', async () => {
  const w = await seedWorkshop('Rotate WS');
  const c2 = await call('POST', `/api/admin/workshops/${w.id}/codes`, { token: T, json: { minutes: 10 } });
  assert.equal(c2.status, 200);
  assert.notEqual(c2.data.code, w.code);
  const { token } = await login('rot1');
  const old = await call('POST', '/api/redeem', { token, json: { code: w.code } });
  assert.equal(old.status, 400);
  const fresh = await call('POST', '/api/redeem', { token, json: { code: c2.data.code } });
  assert.equal(fresh.status, 200);
});

test('minutes clamps to 1..129600 (90 days), default 5', async () => {
  const w = await seedWorkshop('Clamp WS');
  const life = async (minutes) => { const c = await call('POST', `/api/admin/workshops/${w.id}/codes`, { token: T, json: minutes === undefined ? {} : { minutes } }); assert.equal(c.status, 200); return { ms: c.data.expiresAt - c.data.serverNow, d: c.data }; };
  assert.equal((await life(1)).ms, 60000);
  assert.equal((await life(-50)).ms, 60000);
  assert.equal((await life(0)).ms, 5 * 60000);
  assert.equal((await life('abc')).ms, 5 * 60000);
  assert.equal((await life(undefined)).ms, 5 * 60000);
  assert.equal((await life(1440)).ms, 1440 * 60000);
  assert.equal((await life(43200)).ms, 43200 * 60000);
  const d90 = await life(129600);
  assert.equal(d90.ms, 129600 * 60000);
  assert.equal(d90.d.neverExpires, undefined); // a 90-day code is an ordinary timed code
  assert.ok(d90.d.expiresAt < 253402300799000);
  assert.equal((await life(129601)).ms, 129600 * 60000);
  assert.equal((await life(999999999)).ms, 129600 * 60000);
});

test('item validation: title, https url, kind', async () => {
  const w = await seedWorkshop('Item WS');
  const post = (json) => call('POST', `/api/admin/workshops/${w.id}/items`, { token: T, json });
  assert.equal((await post({ kind: 'prompt', body: 'x' })).status, 422);
  assert.equal((await post({ kind: 'bonus', title: 't', url: 'http://example.com' })).status, 422);
  assert.equal((await post({ kind: 'video', title: 't' })).status, 422);
  assert.equal((await post({ kind: 'bonus', title: 't', url: 'https://example.com' })).status, 200);
});

test('admin item list includes the sort order so the editor can show and keep it', async () => {
  const w = await seedWorkshop('Sort WS');
  await call('POST', `/api/admin/workshops/${w.id}/items`, { token: T, json: { kind: 'prompt', title: 'Sorted', sort: 7 } });
  const items = (await call('GET', `/api/admin/workshops/${w.id}/items`, { token: T })).data.items;
  assert.equal(items.length, 1);
  assert.equal(items[0].sort, 7);
});

test('removing an enrollment makes the learner workshop view 403 again', async () => {
  const w = await seedWorkshop('Unenroll WS');
  const token = await enroll('unenroll1', w.code);
  assert.equal((await call('GET', `/api/workshops/${w.id}`, { token })).status, 200);
  const r = await call('DELETE', `/api/admin/workshops/${w.id}/members/unenroll1`, { token: T });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', `/api/workshops/${w.id}`, { token })).status, 403);
});

test('deleting a workshop removes its codes, enrollments and items', async () => {
  const w = await seedWorkshop('Doomed WS');
  await addItem(w.id, { kind: 'prompt', title: 'p1', body: 'b' });
  await enroll('doomed1', w.code);
  const n = (sql) => Number(d1(sql).match(/"n":\s*(\d+)/)[1]);
  const count = (t) => n(`SELECT COUNT(*) AS n FROM ${t} WHERE workshop_id='${w.id}'`);
  assert.ok(count('codes') >= 1 && count('enrollments') === 1 && count('items') === 1);
  assert.equal((await call('DELETE', `/api/admin/workshops/${w.id}`, { token: T })).status, 200);
  assert.equal(count('codes'), 0);
  assert.equal(count('enrollments'), 0);
  assert.equal(count('items'), 0);
});

test('CSV export: BOM, header, neutralised formula cells, workshop filter and all', async () => {
  const a = await seedWorkshop('CSV A');
  const b = await seedWorkshop('CSV B');
  await enroll('csv1', a.code, { ...good, firstName: '=1+1', email: '+a@b.co' });
  await enroll('csv2', b.code, { ...good, firstName: 'Plain', lastName: 'Comma, "Q"', email: 'plain@example.com' });

  const get = async (q) => {
    const res = await fetch(BASE + '/api/admin/members.csv' + q, { headers: { authorization: 'Bearer ' + T } });
    return { res, buf: Buffer.from(await res.arrayBuffer()) };
  };
  const { res, buf } = await get('?workshop=' + a.id);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv; charset=utf-8/i);
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = buf.toString('utf8').slice(1);
  const lines = text.trim().split(/\r?\n/);
  assert.match(lines[0], /email/i);
  assert.equal(lines.length, 2);
  assert.ok(text.includes("'=1+1"));
  assert.ok(text.includes("'+a@b.co"));
  for (const raw of ['=1+1', '+a@b.co']) {
    for (const cell of lines[1].split(',')) assert.ok(!cell.replace(/^"/, '').startsWith(raw), 'raw ' + raw);
  }
  assert.ok(!text.includes('plain@example.com'));

  const all = (await get('')).buf.toString('utf8');
  assert.ok(all.includes('plain@example.com') && all.includes("'+a@b.co"));
  assert.ok(all.includes('"Comma, ""Q"""'));
  assert.equal((await fetch(BASE + '/api/admin/members.csv?workshop=' + a.id)).status, 401);
});

test('copy-from copies text items, leaves source intact, no enrollments or codes', async () => {
  const src = await seedWorkshop('Copy Source');
  await addItem(src.id, { kind: 'prompt', title: 'P1', category: 'c', body: 'prompt body', sort: 2 });
  await addItem(src.id, { kind: 'bonus', title: 'B1', url: 'https://example.com/x', sort: 1 });
  await addItem(src.id, { kind: 'slide', title: 'S1', url: 'https://example.com/slides' });
  await enroll('copysrc1', src.code);
  const dst = await call('POST', '/api/admin/workshops', { token: T, json: { title: 'Copy Dest' } });
  const did = dst.data.id;

  const r = await call('POST', `/api/admin/workshops/${did}/copy-from/${src.id}`, { token: T });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { copied: 3 });

  const strip = (it) => ({ kind: it.kind, title: it.title, category: it.category, body: it.body, url: it.url, sort: it.sort });
  const si = (await call('GET', `/api/admin/workshops/${src.id}/items`, { token: T })).data.items;
  const di = (await call('GET', `/api/admin/workshops/${did}/items`, { token: T })).data.items;
  assert.equal(si.length, 3);
  assert.deepEqual(di.map(strip), si.map(strip));
  assert.ok(di.every((d) => !si.some((s) => s.id === d.id)), 'new rows');

  const n = (sql) => Number(d1(sql).match(/"n":\s*(\d+)/)[1]);
  assert.equal(n(`SELECT COUNT(*) AS n FROM enrollments WHERE workshop_id='${did}'`), 0);
  assert.equal(n(`SELECT COUNT(*) AS n FROM codes WHERE workshop_id='${did}'`), 0);
  assert.equal(n(`SELECT COUNT(*) AS n FROM enrollments WHERE workshop_id='${src.id}'`), 1);
});

test('copy-from is 404 when either workshop is missing', async () => {
  const w = await seedWorkshop('Copy Exists');
  assert.equal((await call('POST', `/api/admin/workshops/${w.id}/copy-from/nope`, { token: T })).status, 404);
  assert.equal((await call('POST', `/api/admin/workshops/nope/copy-from/${w.id}`, { token: T })).status, 404);
});

test('copy-from copies file items under a new R2 key; source file intact', async () => {
  const src = await seedWorkshop('File Source');
  const dst = (await call('POST', '/api/admin/workshops', { token: T, json: { title: 'File Dest' } })).data.id;
  const fd = new FormData();
  fd.set('kind', 'slide'); fd.set('title', 'Deck');
  fd.set('file', new Blob(['hello-bytes'], { type: 'text/plain' }), 'deck.txt');
  const up = await fetch(BASE + `/api/admin/workshops/${src.id}/items`, { method: 'POST', headers: { authorization: 'Bearer ' + T }, body: fd });
  assert.equal(up.status, 200);
  const r = await call('POST', `/api/admin/workshops/${dst}/copy-from/${src.id}`, { token: T });
  assert.deepEqual(r.data, { copied: 1 });
  const keyOf = (w) => d1(`SELECT r2_key FROM items WHERE workshop_id='${w}'`).match(/"r2_key":\s*"([^"]+)"/)[1];
  const [ks, kd] = [keyOf(src.id), keyOf(dst)];
  assert.notEqual(ks, kd);
  assert.ok(kd.startsWith(`workshops/${dst}/`));
  for (const w of [src.id, dst]) {
    const items = (await call('GET', `/api/admin/workshops/${w}/items`, { token: T })).data.items;
    const f = await fetch(BASE + `/api/admin/items/${items[0].id}/file`, { headers: { authorization: 'Bearer ' + T } });
    assert.equal(f.status, 200);
    assert.equal(await f.text(), 'hello-bytes');
  }
});

// ---- never-expiring codes (sentinel 9999-12-31T23:59:59.999Z) ----
const NEVER = 253402300799000;
const issue = (wid, json) => call('POST', `/api/admin/workshops/${wid}/codes`, { token: T, json });
const redeemWith = async (uid, code) => call('POST', '/api/redeem', { token: (await login(uid)).token, json: { code } });

test('never:true stores the sentinel and reports neverExpires with expiresAt null', async () => {
  const w = await seedWorkshop('Never WS');
  const c = await issue(w.id, { never: true });
  assert.equal(c.status, 200);
  assert.match(c.data.code, /^\d{4}$/);
  assert.equal(c.data.expiresAt, null);
  assert.equal(c.data.neverExpires, true);
  assert.equal(typeof c.data.serverNow, 'number');
  assert.ok(d1(`SELECT expires_at FROM codes WHERE workshop_id='${w.id}' AND code='${c.data.code}'`).includes(String(NEVER)));
  assert.ok(d1(`SELECT detail FROM audit_log WHERE action='code_new' ORDER BY id DESC LIMIT 1`).includes('never'));
  const list = await call('GET', `/api/admin/workshops/${w.id}/codes`, { token: T });
  const cur = list.data.codes.find((x) => x.code === c.data.code);
  assert.equal(cur.neverExpires, true);
  assert.equal(cur.expiresAt, null);
  assert.equal(cur.active, true);
  const old = list.data.codes.find((x) => x.code === w.code);
  assert.equal(old.neverExpires, false);
  assert.equal(typeof old.expiresAt, 'number');
  assert.equal(old.revoked, true);
});

test('a never code redeems, and still does long after it was issued', async () => {
  const w = await seedWorkshop('Never redeem');
  const c = await issue(w.id, { never: true });
  assert.equal((await redeemWith('nv1', c.data.code)).status, 200);
  d1(`UPDATE codes SET created_at = 1000, expires_at = ${NEVER} WHERE workshop_id='${w.id}' AND code='${c.data.code}'`);
  const r = await redeemWith('nv2', c.data.code);
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'register');
});

test('a new code revokes the never code; the old one gets the generic refusal', async () => {
  const w = await seedWorkshop('Never rotate');
  const nv = await issue(w.id, { never: true });
  const next = await issue(w.id, { minutes: 10 });
  const wrong = await redeemWith('nr0', '0000');
  const old = await redeemWith('nr1', nv.data.code);
  assert.equal(old.status, 400);
  assert.equal(String(old.data.error).replace(/\d+/g, 'N'), String(wrong.data.error).replace(/\d+/g, 'N'));
  assert.equal((await redeemWith('nr1', next.data.code)).status, 200);
});

test('admin revoke kills a never code', async () => {
  const w = await seedWorkshop('Never revoke');
  const nv = await issue(w.id, { never: true });
  assert.equal((await call('DELETE', `/api/admin/workshops/${w.id}/codes`, { token: T })).status, 200);
  assert.equal((await redeemWith('nrv1', nv.data.code)).status, 400);
  const list = await call('GET', `/api/admin/workshops/${w.id}/codes`, { token: T });
  const row = list.data.codes.find((x) => x.code === nv.data.code);
  assert.equal(row.active, false);
  assert.equal(row.revoked, true);
});

test('a never code in one workshop is never reused for another workshop', async () => {
  // Deterministic: workshop C holds a timed ACTIVE row for every 4-digit code except Z (A's never code) and X.
  // So the only values newCode may hand to B are X, and only if the never row for Z is in its `taken` set.
  // Mutation check: if never rows were dropped from `taken`, Z would be a legal answer and (probing/scanning
  // starts at a random point) each issue would return Z about half the time; 12 issues make that miss 1 in 4096.
  const a = await seedWorkshop('Never A');
  const b = await seedWorkshop('Never B');
  const holder = await seedWorkshop('Never holder');
  const nv = await issue(a.id, { never: true });
  const Z = nv.data.code;
  const X = unusedCode();
  assert.notEqual(X, Z);
  d1(`INSERT INTO codes (workshop_id, code, expires_at, created_at)
      WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 9999)
      SELECT '${holder.id}', printf('%04d', i), 99999999999999, 1 FROM n
      WHERE printf('%04d', i) NOT IN ('${Z}', '${X}')`);
  try {
    for (let i = 0; i < 12; i++) {
      const c = await issue(b.id, { minutes: 5 });
      assert.equal(c.status, 200);
      assert.equal(c.data.code, X);
      // free X again (newCode picks its code before revoking B's previous one)
      assert.equal((await call('DELETE', `/api/admin/workshops/${b.id}/codes`, { token: T })).status, 200);
    }
    // A's never code is still the one redeemable for A.
    assert.equal((await redeemWith('nab1', Z)).status, 200);
  } finally {
    d1(`DELETE FROM codes WHERE workshop_id = '${holder.id}'`);
  }
});

test('never must be strictly boolean true: "true" and 1 fall back to the minutes path', async () => {
  const w = await seedWorkshop('Never strict');
  for (const never of ['true', 1]) {
    const c = await issue(w.id, { never });
    assert.equal(c.status, 200);
    assert.equal(c.data.neverExpires, undefined);
    assert.equal(c.data.expiresAt - c.data.serverNow, 5 * 60000);
  }
  const clamped = await issue(w.id, { never: 'true', minutes: 999999 });
  assert.equal(clamped.data.expiresAt - clamped.data.serverNow, 129600 * 60000);
});
