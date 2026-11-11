import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, stop, call, d1, seedWorkshop, addItem, login, adminLogin, BASE } from './api.helper.mjs';

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

test('minutes clamps to 1 and 1440', async () => {
  const w = await seedWorkshop('Clamp WS');
  const lo = await call('POST', `/api/admin/workshops/${w.id}/codes`, { token: T, json: { minutes: -50 } });
  assert.equal(lo.data.expiresAt - lo.data.serverNow, 60000);
  const hi = await call('POST', `/api/admin/workshops/${w.id}/codes`, { token: T, json: { minutes: 999999 } });
  assert.equal(hi.data.expiresAt - hi.data.serverNow, 1440 * 60000);
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
