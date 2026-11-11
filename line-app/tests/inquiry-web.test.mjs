import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start, stop, call, d1, login, adminLogin, BASE } from './api.helper.mjs';

// Website -> Worker quote requests (POST /api/inquiry/web). The secret is random per run, never a literal.
const SECRET = randomBytes(36).toString('base64');
const SECRET_ENV = 'WEB_INQUIRY_SECRET';
const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

const body = (patch = {}) => ({
  organization: 'บริษัท เว็บ จำกัด', email: 'web@example.com', course: 'Secure Coding', expectation: 'Bootcamp',
  details: 'บรรทัด 1\nบรรทัด 2', learners: 40, emailSent: true, ...patch,
});
const post = (json, token = SECRET) => call('POST', '/api/inquiry/web', { token, json });
// d1() output starts with a wrangler banner; the result is the JSON array that follows it.
const q = (sql) => { const out = d1(sql); return JSON.parse(out.slice(out.indexOf('[\n') >= 0 ? out.indexOf('[\n') : out.indexOf('['))); };
const resetCap = () => d1("DELETE FROM attempts WHERE subject = 'inquiry-web'");
const dbRows = (org) => q(`SELECT * FROM inquiries WHERE organization = '${org.replace(/'/g, "''")}' ORDER BY id`)[0].results;
const total = () => q('SELECT COUNT(*) AS n FROM inquiries')[0].results[0].n;
const orgOf = (tag) => 'web-' + tag + '-' + randomBytes(4).toString('hex');

// ---------- migration ----------

test('migration 0005 exists after 0004 and the older files are untouched', () => {
  const files = readdirSync(MIGRATIONS).sort();
  assert.ok(files.includes('0005_inquiry_source.sql'));
  assert.ok(files.indexOf('0005_inquiry_source.sql') > files.indexOf('0004_consultations.sql'));
  const sql = readFileSync(path.join(MIGRATIONS, '0005_inquiry_source.sql'), 'utf8');
  assert.match(sql, /ALTER TABLE inquiries ADD COLUMN source TEXT NOT NULL DEFAULT 'line'/);
});

before(async () => { await start({ [SECRET_ENV]: SECRET, WEB_INQUIRY_CAP_PER_HOUR: '3' }); });
after(async () => { await stop(); });

test('source column exists and defaults to line for rows that do not set it', () => {
  const cols = q("SELECT name, dflt_value, \"notnull\" FROM pragma_table_info('inquiries') WHERE name = 'source'")[0].results;
  assert.equal(cols.length, 1);
  assert.equal(cols[0].dflt_value, "'line'");
  assert.equal(cols[0].notnull, 1);
  const org = orgOf('legacy');
  d1(`INSERT INTO inquiries (line_user_id, organization, email, course, expectation, learners, created_at) VALUES ('u-old', '${org}', 'a@b.co', 'c', 'e', 1, 1)`);
  assert.equal(dbRows(org)[0].source, 'line');
});

// ---------- auth ----------

test('401 with no bearer, wrong bearer, or a non-Bearer scheme: identical generic body, nothing stored', async () => {
  resetCap();
  const org = orgOf('401');
  const before = total();
  const none = await post(body({ organization: org }), null);
  const wrong = await post(body({ organization: org }), 'x'.repeat(40));
  const basic = await call('POST', '/api/inquiry/web', { headers: { authorization: 'Basic ' + SECRET }, json: body({ organization: org }) });
  assert.equal(none.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(basic.status, 401);
  assert.deepEqual(none.data, wrong.data);
  assert.deepEqual(none.data, basic.data);
  assert.ok(!JSON.stringify(none.data).includes(SECRET));
  assert.equal(total(), before);
  assert.equal(dbRows(org).length, 0);
});

test('a member session, an admin token and the web secret are never interchangeable', async () => {
  resetCap();
  const { token: member } = await login('web-xtoken');
  const admin = await adminLogin();
  assert.equal((await post(body(), member)).status, 401);
  assert.equal((await post(body(), admin)).status, 401);
  // the web secret is not a member session nor an admin token
  assert.equal((await call('POST', '/api/inquiry', { token: SECRET, json: body() })).status, 401);
  assert.equal((await call('GET', '/api/admin/inquiries', { token: SECRET })).status, 401);
  assert.equal((await call('GET', '/api/me', { token: SECRET })).status, 401);
});

// ---------- request shape ----------

test('400 for non-JSON, 413 for oversized (Content-Length and actual length), nothing stored', async () => {
  resetCap();
  const before = total();
  const headers = { authorization: 'Bearer ' + SECRET, 'content-type': 'application/json' };
  const bad = await fetch(BASE + '/api/inquiry/web', { method: 'POST', headers, body: '{nope' });
  assert.equal(bad.status, 400);
  const big = JSON.stringify(body({ details: 'x'.repeat(17 * 1024) }));
  const r413 = await fetch(BASE + '/api/inquiry/web', { method: 'POST', headers, body: big });
  assert.equal(r413.status, 413);
  // no Content-Length (chunked stream): the real length is checked as well
  const chunks = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
  const chunked = await fetch(BASE + '/api/inquiry/web', { method: 'POST', headers, body: chunks, duplex: 'half' });
  assert.equal(chunked.status, 413);
  // just under the limit with valid fields still passes
  const edge = await post(body({ organization: orgOf('edge'), details: 'y'.repeat(2000) }));
  assert.equal(edge.status, 200);
  assert.equal(total(), before + 1);
});

test('422 with field errors for invalid input, nothing stored, no cap slot used', async () => {
  resetCap();
  const before = total();
  for (let i = 0; i < 5; i++) {
    const r = await post(body({ organization: '', email: 'nope', learners: '1e3' }));
    assert.equal(r.status, 422);
    assert.equal(r.data.errors.organization, 'กรอกชื่อองค์กร');
    assert.equal(r.data.errors.email, 'กรอกอีเมลติดต่อให้ถูกต้อง');
    assert.ok(r.data.errors.learners && r.data.error);
  }
  assert.equal((await post(body({ organization: 'a\nb' }))).status, 422);
  assert.equal(total(), before);
  assert.equal((await post(body({ organization: orgOf('after422') }))).status, 200);
});

test('no CORS headers on success or failure', async () => {
  resetCap();
  const h = { authorization: 'Bearer ' + SECRET, 'content-type': 'application/json', origin: 'https://innow.co.th' };
  const ok = await fetch(BASE + '/api/inquiry/web', { method: 'POST', headers: h, body: JSON.stringify(body({ organization: orgOf('cors') })) });
  const no = await fetch(BASE + '/api/inquiry/web', { method: 'POST', headers: { ...h, authorization: 'Bearer nope' }, body: '{}' });
  const pre = await fetch(BASE + '/api/inquiry/web', { method: 'OPTIONS', headers: { origin: 'https://innow.co.th', 'access-control-request-method': 'POST' } });
  for (const res of [ok, no, pre]) assert.equal(res.headers.get('access-control-allow-origin'), null);
});

// ---------- storing ----------

test('200 stores exactly the posted fields as source web with an empty line_user_id', async () => {
  resetCap();
  const org = orgOf('store');
  const r = await post(body({ organization: org }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true });
  const [row] = dbRows(org);
  assert.equal(dbRows(org).length, 1);
  assert.equal(row.source, 'web');
  assert.equal(row.line_user_id, '');
  assert.equal(row.email, 'web@example.com');
  assert.equal(row.course, 'Secure Coding');
  assert.equal(row.expectation, 'Bootcamp');
  assert.equal(row.details, 'บรรทัด 1\nบรรทัด 2');
  assert.equal(row.learners, 40);
  assert.equal(row.forwarded, 1);
  assert.equal(row.forward_error, '');
  assert.ok(Math.abs(row.created_at - Date.now()) < 60_000);
});

test('emailSent: only boolean true counts as sent; anything else is email-failed', async () => {
  const cases = [[true, 1, ''], [false, 0, 'email-failed'], ['true', 0, 'email-failed'], [1, 0, 'email-failed'], [undefined, 0, 'email-failed']];
  for (const [v, forwarded, err] of cases) {
    resetCap();
    const org = orgOf('es');
    const payload = body({ organization: org });
    if (v === undefined) delete payload.emailSent; else payload.emailSent = v;
    assert.equal((await post(payload)).status, 200, String(v));
    const [row] = dbRows(org);
    assert.equal(row.forwarded, forwarded, 'emailSent=' + String(v));
    assert.equal(row.forward_error, err, 'emailSent=' + String(v));
  }
});

test('audit log carries only the inquiry id, no PII; the secret is never logged', async () => {
  resetCap();
  const org = orgOf('audit');
  assert.equal((await post(body({ organization: org, email: 'pii-check@example.com' }))).status, 200);
  const [row] = dbRows(org);
  const log = q("SELECT actor, detail FROM audit_log WHERE action = 'inquiry_web' ORDER BY id DESC LIMIT 1")[0].results[0];
  assert.deepEqual(JSON.parse(log.detail), { id: row.id });
  assert.ok(!log.detail.includes('pii-check') && !log.detail.includes(org) && !log.actor.includes(SECRET));
});

// ---------- cap ----------

test('cap: the 4th request in the hour is 429 with a generic message and nothing stored', async () => {
  resetCap();
  const org = orgOf('cap');
  for (let i = 0; i < 3; i++) assert.equal((await post(body({ organization: org }))).status, 200, 'request ' + (i + 1));
  const r = await post(body({ organization: org }));
  assert.equal(r.status, 429);
  assert.ok(r.data.error);
  assert.ok(!JSON.stringify(r.data).includes(SECRET));
  assert.equal(dbRows(org).length, 3);
  // unauthenticated requests do not consume or bypass the cap either way
  assert.equal((await post(body({ organization: org }), 'wrong-secret-wrong-secret-wrong-secret')).status, 401);
  // rows older than the hour fall out of the window
  const t = Date.now();
  d1(`UPDATE attempts SET created_at = ${t - 61 * 60 * 1000} WHERE subject = 'inquiry-web'`);
  assert.equal((await post(body({ organization: org }))).status, 200);
});

test('cap: a parallel burst of 10 stores at most 3 rows', async () => {
  resetCap();
  const org = orgOf('burst');
  const rs = await Promise.all(Array.from({ length: 10 }, () => post(body({ organization: org }))));
  const okN = rs.filter((r) => r.status === 200).length;
  assert.ok(okN >= 1 && okN <= 3, 'successes: ' + okN);
  assert.equal(rs.filter((r) => r.status === 429).length, 10 - okN);
  assert.equal(dbRows(org).length, okN);
});

// ---------- admin list ----------

test('admin list: web row has source web and empty memberName; LINE row keeps source line; admin token required', async () => {
  resetCap();
  assert.equal((await call('GET', '/api/admin/inquiries')).status, 401);
  const { token: member } = await login('web-list');
  assert.equal((await call('GET', '/api/admin/inquiries', { token: member })).status, 401);
  const webOrg = orgOf('list');
  assert.equal((await post(body({ organization: webOrg, emailSent: false }))).status, 200);
  const lineOrg = orgOf('listline');
  d1(`INSERT INTO inquiries (line_user_id, organization, email, course, expectation, learners, created_at) VALUES ('web-list', '${lineOrg}', 'l@example.com', 'c', 'e', 3, ${Date.now()})`);
  const r = await call('GET', '/api/admin/inquiries', { token: await adminLogin() });
  assert.equal(r.status, 200);
  const w = r.data.inquiries.find((x) => x.organization === webOrg);
  const l = r.data.inquiries.find((x) => x.organization === lineOrg);
  assert.equal(w.source, 'web');
  assert.equal(w.memberName, '');
  assert.equal(w.forwarded, false);
  assert.equal(w.forwardError, 'email-failed');
  assert.equal(w.learners, 40);
  assert.equal(l.source, 'line');
});

// ---------- fail closed (second server instance without the secret) ----------

test('503 when the secret is not configured, empty or shorter than 32 chars; nothing stored', async () => {
  for (const vars of [{}, { [SECRET_ENV]: '' }, { [SECRET_ENV]: 'short-secret' }]) {
    await stop();
    await start(vars);
    const org = orgOf('503');
    const r = await post(body({ organization: org }), vars[SECRET_ENV] || 'anything-at-all-anything-at-all-xx');
    assert.equal(r.status, 503, JSON.stringify(vars));
    assert.deepEqual(r.data, { error: 'Service unavailable' });
    assert.equal(dbRows(org).length, 0);
  }
});
