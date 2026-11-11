import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { validateInquiry } from '../src/lib.js';
import { start, stop, call, d1, login, adminLogin, waitForLogLine } from './api.helper.mjs';

// ---------- validateInquiry (mirrors lib/contact-message.mjs) ----------

const ok = { organization: 'บริษัท ตัวอย่าง จำกัด', email: 'hr@example.com', course: 'Secure Coding', expectation: 'Bootcamp', details: '', learners: 20 };
const bad = (patch) => validateInquiry({ ...ok, ...patch });

test('validateInquiry: valid input is ok and trimmed', () => {
  const r = validateInquiry({ organization: '  บริษัท  ', email: ' a@b.co ', course: ' c ', expectation: ' e ', details: ' d ', learners: '20' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, {});
  assert.deepEqual(r.value, { organization: 'บริษัท', email: 'a@b.co', course: 'c', expectation: 'e', details: 'd', learners: 20 });
});

test('validateInquiry: organization 1-160 chars, no CR/LF', () => {
  assert.equal(bad({ organization: '' }).errors.organization, 'กรอกชื่อองค์กร');
  assert.equal(bad({ organization: '   ' }).ok, false);
  assert.equal(bad({ organization: 'x'.repeat(160) }).ok, true);
  assert.equal(bad({ organization: 'x'.repeat(161) }).errors.organization, 'กรอกชื่อองค์กร');
  assert.equal(bad({ organization: 'a\nb' }).ok, false);
  assert.equal(bad({ organization: 'a\rb' }).ok, false);
  assert.equal(bad({ organization: undefined }).ok, false);
  assert.equal(bad({ organization: 5 }).ok, false);
});

test('validateInquiry: email <= 254 and shape', () => {
  assert.equal(bad({ email: '' }).errors.email, 'กรอกอีเมลติดต่อให้ถูกต้อง');
  for (const e of ['abc', 'a@b', 'a b@c.com', '@b.com', 'a@@b.com', 'a@b .com']) assert.equal(bad({ email: e }).ok, false, e);
  const local = (n) => 'a'.repeat(n - '@b.co'.length) + '@b.co';
  assert.equal(local(254).length, 254);
  assert.equal(bad({ email: local(254) }).ok, true);
  assert.equal(bad({ email: local(255) }).ok, false);
});

test('validateInquiry: course 1-200 chars, no CR/LF', () => {
  assert.equal(bad({ course: '' }).errors.course, 'เลือกหลักสูตรที่สนใจ');
  assert.equal(bad({ course: 'x'.repeat(200) }).ok, true);
  assert.equal(bad({ course: 'x'.repeat(201) }).errors.course, 'เลือกหลักสูตรที่สนใจ');
  assert.equal(bad({ course: 'a\nb' }).ok, false);
});

test('validateInquiry: expectation 1-300 chars, no CR/LF', () => {
  assert.equal(bad({ expectation: '' }).errors.expectation, 'เลือกรูปแบบที่ต้องการ');
  assert.equal(bad({ expectation: 'x'.repeat(300) }).ok, true);
  assert.equal(bad({ expectation: 'x'.repeat(301) }).errors.expectation, 'เลือกรูปแบบที่ต้องการ');
  assert.equal(bad({ expectation: 'a\r\nb' }).ok, false);
});

test('validateInquiry: details optional, <= 2000, CR/LF allowed', () => {
  assert.equal(bad({ details: undefined }).ok, true);
  assert.equal(bad({ details: undefined }).value.details, '');
  assert.equal(bad({ details: 'x'.repeat(2000) }).ok, true);
  assert.equal(bad({ details: 'x'.repeat(2001) }).ok, false);
  assert.equal(bad({ details: 'a\nb\r\nc' }).ok, true);
  assert.equal(bad({ details: 'a\nb' }).value.details, 'a\nb');
});

test('validateInquiry: learners is a safe integer 1..100000, numeric strings accepted', () => {
  const msg = 'กรอกจำนวนผู้เรียนเป็นจำนวนเต็มตั้งแต่ 1 ถึง 100,000 คน';
  assert.equal(bad({ learners: 0 }).errors.learners, msg);
  assert.equal(bad({ learners: 1 }).ok, true);
  assert.equal(bad({ learners: 100000 }).ok, true);
  assert.equal(bad({ learners: 100001 }).ok, false);
  assert.equal(bad({ learners: -3 }).ok, false);
  assert.equal(bad({ learners: '20' }).value.learners, 20);
  for (const v of ['20.5', '1e3', '', ' ', 'abc', NaN, Infinity, 20.5, null, undefined, {}, [], true, '0x10', '2 0']) assert.equal(bad({ learners: v }).ok, false, String(v));
  assert.equal(bad({ learners: ' 20 ' }).ok, true);
});

test('validateInquiry: non-object input and several errors at once', () => {
  for (const v of [null, undefined, 5, 'x', []]) assert.equal(validateInquiry(v).ok, false);
  const r = validateInquiry({});
  assert.deepEqual(Object.keys(r.errors).sort(), ['course', 'email', 'expectation', 'learners', 'organization']);
});

// ---------- POST /api/inquiry and GET /api/admin/inquiries ----------

// Local stand-in for the website's /api/contact. mode: 'ok' | 'fail' | 'hang'.
let target; let targetPort; let mode = 'ok'; const hits = [];
const conns = new Set();
let other; let otherPort; const otherHits = [];

before(async () => {
  other = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { otherHits.push({ url: req.url, body: b }); res.writeHead(200); res.end('{}'); });
  });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  otherPort = other.address().port;
  target = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, headers: req.headers, body: b });
      if (mode === 'hang') return; // never answer
      if (mode === 'redirect') { res.writeHead(307, { location: `http://127.0.0.1:${otherPort}/stolen` }); return res.end(); }
      if (mode === 'fail') { res.writeHead(500, { 'content-type': 'text/plain' }); return res.end('SECRET-BODY-DO-NOT-STORE'); }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
  });
  target.on('connection', (s) => { conns.add(s); s.on('close', () => conns.delete(s)); });
  await new Promise((r) => target.listen(0, '127.0.0.1', r));
  targetPort = target.address().port;
  await start({ INQUIRY_FORWARD_URL: `http://127.0.0.1:${targetPort}/api/contact`, INQUIRY_FORWARD_TIMEOUT_MS: '300' });
});
after(async () => {
  await stop();
  for (const s of conns) s.destroy();
  await new Promise((r) => target.close(r));
  await new Promise((r) => other.close(r));
});

const form = (patch = {}) => ({ organization: 'บริษัท ทดสอบ จำกัด', email: 'hr@example.com', course: 'Secure Coding', expectation: 'Bootcamp มุ่งสร้างผลงาน', details: 'บรรทัด 1\nบรรทัด 2', learners: 25, ...patch });
const rows = (uid) => d1(`SELECT * FROM inquiries WHERE line_user_id='${uid}' ORDER BY id`);
const rowCount = (uid) => (rows(uid).match(/"id":/g) || []).length;

test('stores a row and forwards once with exactly the JSON the website expects', async () => {
  hits.length = 0; mode = 'ok';
  const { token } = await login('inq-ok');
  const r = await call('POST', '/api/inquiry', { token, json: form() });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true, forwarded: true });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].method, 'POST');
  assert.equal(hits[0].url, '/api/contact');
  assert.match(hits[0].headers['content-type'], /^application\/json/);
  assert.equal(hits[0].headers['user-agent'], 'innow-line-worker');
  assert.deepEqual(JSON.parse(hits[0].body), { organization: 'บริษัท ทดสอบ จำกัด', email: 'hr@example.com', course: 'Secure Coding', expectation: 'Bootcamp มุ่งสร้างผลงาน', details: 'บรรทัด 1\nบรรทัด 2', learners: 25, website: '' });
  const out = rows('inq-ok');
  assert.equal(rowCount('inq-ok'), 1);
  assert.match(out, /"forwarded":\s*1/);
  assert.match(out, /"forward_error":\s*""/);
  assert.match(out, /"learners":\s*25/);
});

test('numeric-string learners is accepted and forwarded as a number', async () => {
  hits.length = 0; mode = 'ok';
  const { token } = await login('inq-str');
  const r = await call('POST', '/api/inquiry', { token, json: form({ learners: '30' }) });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(hits[0].body).learners, 30);
});

test('forward target 500: still 200 forwarded:false, row kept, error is the status code only', async () => {
  hits.length = 0; mode = 'fail';
  const { token } = await login('inq-500');
  const r = await call('POST', '/api/inquiry', { token, json: form() });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true, forwarded: false });
  const out = rows('inq-500');
  assert.match(out, /"forwarded":\s*0/);
  assert.match(out, /"forward_error":\s*"500"/);
  assert.ok(!out.includes('SECRET-BODY'));
});

test('forward target that hangs: 200 forwarded:false after the timeout, row kept', async () => {
  hits.length = 0; mode = 'hang';
  const { token } = await login('inq-hang');
  const t0 = Date.now();
  const r = await call('POST', '/api/inquiry', { token, json: form() });
  const took = Date.now() - t0;
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true, forwarded: false });
  assert.ok(took < 5000, 'took ' + took);
  assert.match(rows('inq-hang'), /"forward_error":\s*"timeout"/);
  for (const s of conns) s.destroy();
  mode = 'ok';
});

test('forward target answering 307: never followed, forwarded:false with the status, second host gets nothing', async () => {
  hits.length = 0; otherHits.length = 0; mode = 'redirect';
  const { token } = await login('inq-redir');
  const r = await call('POST', '/api/inquiry', { token, json: form() });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true, forwarded: false });
  assert.equal(hits.length, 1);
  assert.equal(otherHits.length, 0, 'redirect target must not receive the lead');
  const out = rows('inq-redir');
  assert.match(out, /"forwarded":\s*0/);
  assert.match(out, /"forward_error":\s*"307"/);
  mode = 'ok';
});

test('a failing UPDATE after a successful forward still answers 200 forwarded:true', async () => {
  hits.length = 0; mode = 'ok';
  d1("CREATE TRIGGER inq_block_update BEFORE UPDATE ON inquiries BEGIN SELECT RAISE(ABORT, 'blocked'); END");
  try {
    const { token } = await login('inq-upd');
    const r = await call('POST', '/api/inquiry', { token, json: form() });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { ok: true, forwarded: true });
    assert.equal(hits.length, 1);
    assert.equal(rowCount('inq-upd'), 1);
    // The failure is logged without any personal data: only the inquiry id.
    const line = await waitForLogLine('inquiry status update failed');
    assert.ok(line, 'expected the failure to be logged');
    assert.match(line, /inquiry status update failed\D+\d+/);
    const f = form();
    assert.ok(!line.includes(f.email) && !line.includes(f.organization) && !line.includes('hr@'), 'log line must not carry PII');
  } finally {
    d1('DROP TRIGGER inq_block_update');
  }
});

test('validation: 422 with per-field errors, nothing stored or forwarded, no limit slot used', async () => {
  hits.length = 0; mode = 'ok';
  const { token } = await login('inq-422');
  for (let i = 0; i < 5; i++) {
    const r = await call('POST', '/api/inquiry', { token, json: form({ organization: '', email: 'nope', learners: '1e3' }) });
    assert.equal(r.status, 422);
    assert.equal(r.data.errors.organization, 'กรอกชื่อองค์กร');
    assert.equal(r.data.errors.email, 'กรอกอีเมลติดต่อให้ถูกต้อง');
    assert.ok(r.data.errors.learners);
    assert.ok(r.data.error);
  }
  assert.equal(hits.length, 0);
  assert.equal(rowCount('inq-422'), 0);
  const good = await call('POST', '/api/inquiry', { token, json: form() });
  assert.equal(good.status, 200);
});

test('401 without a session or with a garbage / admin token; 403 for a non-friend', async () => {
  hits.length = 0;
  assert.equal((await call('POST', '/api/inquiry', { json: form() })).status, 401);
  assert.equal((await call('POST', '/api/inquiry', { token: 'garbage', json: form() })).status, 401);
  assert.equal((await call('POST', '/api/inquiry', { token: await adminLogin(), json: form() })).status, 401);
  const { token } = await login('nofriend-inq');
  const r = await call('POST', '/api/inquiry', { token, json: form() });
  assert.equal(r.status, 403);
  assert.equal(r.data.notFriend, true);
  assert.equal(hits.length, 0);
  assert.equal(rowCount('nofriend-inq'), 0);
});

test('malformed JSON body is 400', async () => {
  const { token } = await login('inq-badjson');
  const res = await fetch('http://127.0.0.1:8799/api/inquiry', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(res.status, 400);
});

test('limit: 4th submission within an hour is 429 (failed forwards count too); another user is unaffected', async () => {
  hits.length = 0; mode = 'fail';
  const { token } = await login('inq-limit');
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/api/inquiry', { token, json: form() })).status, 200, 'submission ' + (i + 1));
  const r = await call('POST', '/api/inquiry', { token, json: form() });
  assert.equal(r.status, 429);
  assert.equal(r.data.error, 'ส่งคำขอบ่อยเกินไป กรุณาลองใหม่ภายหลัง');
  assert.equal(rowCount('inq-limit'), 3);
  assert.equal(hits.length, 3);
  mode = 'ok';
  const other = await login('inq-limit-other');
  assert.equal((await call('POST', '/api/inquiry', { token: other.token, json: form() })).status, 200);
});

test('limit counts rows older than 10 minutes but inside the hour; rows older than an hour are released', async () => {
  mode = 'ok';
  const { token } = await login('inq-window');
  const t = Date.now();
  d1(`INSERT INTO attempts (subject, ok, created_at) VALUES ('inquiry:inq-window', 0, ${t - 30 * 60 * 1000}), ('inquiry:inq-window', 0, ${t - 40 * 60 * 1000}), ('inquiry:inq-window', 0, ${t - 50 * 60 * 1000})`);
  assert.equal((await call('POST', '/api/inquiry', { token, json: form() })).status, 429);
  d1(`UPDATE attempts SET created_at = ${t - 61 * 60 * 1000} WHERE subject = 'inquiry:inq-window' AND created_at = ${t - 50 * 60 * 1000}`);
  assert.equal((await call('POST', '/api/inquiry', { token, json: form() })).status, 200);
});

test('burst of 10 parallel submissions: at most 3 succeed', async () => {
  mode = 'ok';
  const { token } = await login('inq-burst');
  const rs = await Promise.all(Array.from({ length: 10 }, () => call('POST', '/api/inquiry', { token, json: form() })));
  const okN = rs.filter((r) => r.status === 200).length;
  assert.ok(okN >= 1 && okN <= 3, 'successes: ' + okN);
  assert.equal(rs.filter((r) => r.status === 429).length, 10 - okN);
  assert.equal(rowCount('inq-burst'), okN);
});

test('admin list: 401 without token or with a member token; 200 with admin token, newest first, member name joined', async () => {
  mode = 'ok';
  assert.equal((await call('GET', '/api/admin/inquiries')).status, 401);
  const { token: mtoken } = await login('inq-admin');
  assert.equal((await call('GET', '/api/admin/inquiries', { token: mtoken })).status, 401);

  const t = Date.now();
  d1(`INSERT INTO members (line_user_id, first_name, last_name, email, terms_accepted_at, last_seen_at, created_at) VALUES ('inq-admin', 'สมหญิง', 'รักเรียน', 'sy@example.com', ${t}, ${t}, ${t})`);
  const a = await call('POST', '/api/inquiry', { token: mtoken, json: form({ organization: 'Org A' }) });
  assert.equal(a.status, 200);
  const { token: m2 } = await login('inq-admin-nomember');
  assert.equal((await call('POST', '/api/inquiry', { token: m2, json: form({ organization: 'Org B' }) })).status, 200);

  const admin = await adminLogin();
  const r = await call('GET', '/api/admin/inquiries', { token: admin });
  assert.equal(r.status, 200);
  const list = r.data.inquiries;
  const iA = list.findIndex((x) => x.organization === 'Org A');
  const iB = list.findIndex((x) => x.organization === 'Org B');
  assert.ok(iA >= 0 && iB >= 0);
  assert.ok(iB < iA, 'newest first');
  assert.deepEqual(Object.keys(list[iA]).sort(), ['course', 'createdAt', 'details', 'email', 'expectation', 'forwardError', 'forwarded', 'id', 'learners', 'memberName', 'organization']);
  assert.equal(list[iA].memberName, 'สมหญิง รักเรียน');
  assert.equal(list[iB].memberName, '');
  assert.equal(list[iA].forwarded, true);
  assert.equal(list[iA].learners, 25);
  assert.equal(list[iA].details, 'บรรทัด 1\nบรรทัด 2');
  assert.equal(typeof list[iA].createdAt, 'number');
  assert.ok(list.length <= 200);
});

test('inquiries are not exposed through the learner API', async () => {
  const { token } = await login('inq-ok');
  const me = await call('GET', '/api/me', { token });
  assert.ok(!JSON.stringify(me.data).includes('hr@example.com'));
  assert.equal((await call('GET', '/api/inquiries', { token })).status, 404);
});

test('network error (closed port): 200 forwarded:false, error "network"', async () => {
  mode = 'ok';
  const old = target;
  for (const s of conns) s.destroy();
  await new Promise((r) => old.close(r));
  const { token } = await login('inq-net');
  const r = await call('POST', '/api/inquiry', { token, json: form() });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true, forwarded: false });
  assert.match(rows('inq-net'), /"forward_error":\s*"network"/);
  // restart the stand-in on the same port for the rest of the file
  await new Promise((res, rej) => { old.once('error', rej); old.listen(targetPort, '127.0.0.1', res); });
});

test('empty INQUIRY_FORWARD_URL disables forwarding; non-https non-loopback URLs are refused', async () => {
  for (const url of ['', 'http://example.com/api/contact']) {
    await stop();
    hits.length = 0;
    await start({ INQUIRY_FORWARD_URL: url });
    const { token } = await login('inq-off');
    const r = await call('POST', '/api/inquiry', { token, json: form() });
    assert.equal(r.status, 200, url);
    assert.deepEqual(r.data, { ok: true, forwarded: false });
    assert.match(rows('inq-off'), /"forward_error":\s*"disabled"/);
    assert.equal(hits.length, 0);
  }
});
