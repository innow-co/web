import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateConsultation } from '../src/lib.js';
import { start, stop, call, d1, login, adminLogin, BASE } from './api.helper.mjs';

// ---------- validateConsultation ----------

const ok = { organization: 'บริษัท ตัวอย่าง จำกัด', systems: 'Excel, LINE OA', goals: 'สรุปยอดขายอัตโนมัติ', teamSize: 20, email: 'hr@example.com' };
const bad = (patch) => validateConsultation({ ...ok, ...patch });
const MSG = {
  organization: 'กรอกชื่อองค์กร',
  email: 'กรอกอีเมลติดต่อให้ถูกต้อง',
  systems: 'เล่าระบบที่ใช้อยู่ตอนนี้ (ไม่เกิน 2,000 ตัวอักษร)',
  goals: 'เล่างานที่อยากให้ AI ช่วย (ไม่เกิน 2,000 ตัวอักษร)',
  teamSize: 'กรอกขนาดทีมเป็นจำนวนเต็มตั้งแต่ 1 ถึง 100,000 คน',
};

test('validateConsultation: valid input is ok and trimmed; team size number or numeric string', () => {
  const r = validateConsultation({ organization: '  บริษัท  ', email: ' a@b.co ', systems: ' ระบบ ', goals: ' งาน ', teamSize: '20' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, {});
  assert.deepEqual(r.value, { organization: 'บริษัท', email: 'a@b.co', systems: 'ระบบ', goals: 'งาน', teamSize: 20 });
  assert.equal(validateConsultation(ok).value.teamSize, 20);
});

test('validateConsultation: organization 1-160, no CR/LF, whitespace-only is empty', () => {
  assert.equal(bad({ organization: '' }).errors.organization, MSG.organization);
  assert.equal(bad({ organization: '   ' }).ok, false);
  assert.equal(bad({ organization: 'x'.repeat(160) }).ok, true);
  assert.equal(bad({ organization: 'x'.repeat(161) }).errors.organization, MSG.organization);
  assert.equal(bad({ organization: 'a\nb' }).ok, false);
  assert.equal(bad({ organization: 'a\rb' }).ok, false);
  assert.equal(bad({ organization: undefined }).ok, false);
  assert.equal(bad({ organization: 5 }).ok, false);
});

test('validateConsultation: email required, <= 254, shape', () => {
  assert.equal(bad({ email: '' }).errors.email, MSG.email);
  for (const e of ['abc', 'a@b', 'a b@c.com', '@b.com', 'a@@b.com', 'a@b .com', '   ']) assert.equal(bad({ email: e }).ok, false, e);
  const local = (n) => 'a'.repeat(n - '@b.co'.length) + '@b.co';
  assert.equal(bad({ email: local(254) }).ok, true);
  assert.equal(bad({ email: local(255) }).ok, false);
});

for (const f of ['systems', 'goals']) {
  test(`validateConsultation: ${f} required, 1..2000, CR/LF allowed, whitespace-only is empty`, () => {
    assert.equal(bad({ [f]: '' }).errors[f], MSG[f]);
    assert.equal(bad({ [f]: ' ' }).errors[f], MSG[f]);
    assert.equal(bad({ [f]: ' \n\r\n ' }).ok, false);
    assert.equal(bad({ [f]: undefined }).ok, false);
    assert.equal(bad({ [f]: 'x'.repeat(2000) }).ok, true);
    assert.equal(bad({ [f]: 'x'.repeat(2001) }).errors[f], MSG[f]);
    assert.equal(bad({ [f]: 'a\nb\r\nc' }).ok, true);
    assert.equal(bad({ [f]: 'a\nb' }).value[f], 'a\nb');
  });
}

test('validateConsultation: team size optional, integer 1..100000, strict', () => {
  for (const v of [undefined, '', null]) { const r = bad({ teamSize: v }); assert.equal(r.ok, true, String(v)); assert.equal(r.value.teamSize, null); }
  assert.equal(bad({ teamSize: 1 }).ok, true);
  assert.equal(bad({ teamSize: '100000' }).value.teamSize, 100000);
  assert.equal(bad({ teamSize: ' 20 ' }).value.teamSize, 20);
  assert.equal(bad({ teamSize: 0 }).errors.teamSize, MSG.teamSize);
  for (const v of ['20.5', '1e3', ' ', 'abc', '0', '100001', 100001, -3, NaN, Infinity, 20.5, {}, [], true, '0x10', '2 0']) assert.equal(bad({ teamSize: v }).ok, false, String(v));
});

test('validateConsultation: non-object input and several errors at once', () => {
  for (const v of [null, undefined, 5, 'x', []]) assert.equal(validateConsultation(v).ok, false);
  assert.deepEqual(Object.keys(validateConsultation({}).errors).sort(), ['email', 'goals', 'organization', 'systems']);
});

// ---------- migration ----------

test('migration 0004 exists, creates consultations, and 0003 is not ours', () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
  const files = readdirSync(dir).sort();
  assert.ok(files.includes('0004_consultations.sql'));
  assert.ok(files.indexOf('0004_consultations.sql') > files.indexOf('0002_inquiries.sql'));
  assert.ok(!files.some((f) => /^0003_.*consult/i.test(f)), '0003 is reserved for another feature');
});

// ---------- API ----------

before(async () => { await start(); });
after(async () => { await stop(); });

const form = (patch = {}) => ({ organization: 'บริษัท ทดสอบ จำกัด', systems: 'Excel และ LINE OA\nERP บัญชี', goals: 'สรุปยอดขายประจำวัน', teamSize: 12, email: 'hr@example.com', ...patch });
const rows = (uid) => d1(`SELECT * FROM consultations WHERE line_user_id='${uid}' ORDER BY id`);
const rowCount = (uid) => (rows(uid).match(/"id":/g) || []).length;

test('table exists on a fresh DB after migrations 0001..0004', () => {
  assert.match(d1("SELECT name FROM sqlite_master WHERE type='table' AND name='consultations'"), /consultations/);
  assert.match(d1("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='consultations'"), /created/);
});

test('stores a row with the session uid and the exact fields', async () => {
  const { token } = await login('con-ok');
  const r = await call('POST', '/api/consultation', { token, json: form() });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true });
  const out = rows('con-ok');
  assert.equal(rowCount('con-ok'), 1);
  assert.match(out, /"organization":\s*"บริษัท ทดสอบ จำกัด"/);
  assert.match(out, /"email":\s*"hr@example.com"/);
  assert.match(out, /"systems":\s*"Excel และ LINE OA\\nERP บัญชี"/);
  assert.match(out, /"goals":\s*"สรุปยอดขายประจำวัน"/);
  assert.match(out, /"team_size":\s*12/);
});

test('team size omitted is stored as NULL; numeric string accepted', async () => {
  const { token } = await login('con-null');
  const a = form(); delete a.teamSize;
  assert.equal((await call('POST', '/api/consultation', { token, json: a })).status, 200);
  assert.equal((await call('POST', '/api/consultation', { token, json: form({ teamSize: '30' }) })).status, 200);
  const out = rows('con-null');
  assert.match(out, /"team_size":\s*null/);
  assert.match(out, /"team_size":\s*30/);
});

test('line_user_id in the body is ignored', async () => {
  const { token } = await login('con-real');
  const r = await call('POST', '/api/consultation', { token, json: { ...form(), line_user_id: 'con-victim', lineUserId: 'con-victim', uid: 'con-victim' } });
  assert.equal(r.status, 200);
  assert.equal(rowCount('con-real'), 1);
  assert.equal(rowCount('con-victim'), 0);
});

test('validation: 422 with per-field errors, nothing stored, no limit slot used', async () => {
  const { token } = await login('con-422');
  for (let i = 0; i < 5; i++) {
    const r = await call('POST', '/api/consultation', { token, json: form({ organization: '', email: 'nope', systems: ' ', goals: 'x'.repeat(2001), teamSize: '1e3' }) });
    assert.equal(r.status, 422);
    assert.equal(r.data.errors.organization, MSG.organization);
    assert.equal(r.data.errors.email, MSG.email);
    assert.equal(r.data.errors.systems, MSG.systems);
    assert.equal(r.data.errors.goals, MSG.goals);
    assert.equal(r.data.errors.teamSize, MSG.teamSize);
    assert.ok(r.data.error);
  }
  assert.equal(rowCount('con-422'), 0);
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/api/consultation', { token, json: form() })).status, 200, 'slot ' + (i + 1));
});

test('401 without a session or with a garbage / admin token; 403 for a non-friend', async () => {
  assert.equal((await call('POST', '/api/consultation', { json: form() })).status, 401);
  assert.equal((await call('POST', '/api/consultation', { token: 'garbage', json: form() })).status, 401);
  assert.equal((await call('POST', '/api/consultation', { token: await adminLogin(), json: form() })).status, 401);
  const { token } = await login('nofriend-con');
  const r = await call('POST', '/api/consultation', { token, json: form() });
  assert.equal(r.status, 403);
  assert.equal(r.data.notFriend, true);
  assert.equal(rowCount('nofriend-con'), 0);
});

test('malformed JSON body is 400; a JSON non-object is 422', async () => {
  const { token } = await login('con-badjson');
  const res = await fetch(BASE + '/api/consultation', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(res.status, 400);
  assert.equal((await call('POST', '/api/consultation', { token, json: 'text' })).status, 422);
  assert.equal(rowCount('con-badjson'), 0);
});

test('limit: 4th submission within an hour is 429; another user is unaffected', async () => {
  const { token } = await login('con-limit');
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/api/consultation', { token, json: form() })).status, 200, 'submission ' + (i + 1));
  const r = await call('POST', '/api/consultation', { token, json: form() });
  assert.equal(r.status, 429);
  assert.ok(r.data.error);
  assert.equal(rowCount('con-limit'), 3);
  const other = await login('con-limit-other');
  assert.equal((await call('POST', '/api/consultation', { token: other.token, json: form() })).status, 200);
});

test('the limit is its own subject: quote inquiries do not use the consultation slots', async () => {
  const { token } = await login('con-sep');
  d1(`INSERT INTO attempts (subject, ok, created_at) VALUES ('inquiry:con-sep', 0, ${Date.now()}), ('inquiry:con-sep', 0, ${Date.now()}), ('inquiry:con-sep', 0, ${Date.now()})`);
  assert.equal((await call('POST', '/api/consultation', { token, json: form() })).status, 200);
});

test('rows older than an hour no longer count', async () => {
  const { token } = await login('con-window');
  const t = Date.now();
  d1(`INSERT INTO attempts (subject, ok, created_at) VALUES ('consult:con-window', 0, ${t - 30 * 60000}), ('consult:con-window', 0, ${t - 40 * 60000}), ('consult:con-window', 0, ${t - 50 * 60000})`);
  assert.equal((await call('POST', '/api/consultation', { token, json: form() })).status, 429);
  d1(`UPDATE attempts SET created_at = ${t - 61 * 60000} WHERE subject = 'consult:con-window' AND created_at = ${t - 50 * 60000}`);
  assert.equal((await call('POST', '/api/consultation', { token, json: form() })).status, 200);
});

test('burst of 10 parallel submissions: at most 3 succeed, the rest are 429', async () => {
  const { token } = await login('con-burst');
  const rs = await Promise.all(Array.from({ length: 10 }, () => call('POST', '/api/consultation', { token, json: form() })));
  const okN = rs.filter((r) => r.status === 200).length;
  assert.ok(okN >= 1 && okN <= 3, 'successes: ' + okN);
  assert.equal(rs.filter((r) => r.status === 429).length, 10 - okN);
  assert.equal(rowCount('con-burst'), okN);
});

test('admin list: 401 without token or with a member token; newest first with member name; fields exact', async () => {
  assert.equal((await call('GET', '/api/admin/consultations')).status, 401);
  const { token: mtoken } = await login('con-admin');
  assert.equal((await call('GET', '/api/admin/consultations', { token: mtoken })).status, 401);
  const t = Date.now();
  d1(`INSERT INTO members (line_user_id, first_name, last_name, email, terms_accepted_at, last_seen_at, created_at) VALUES ('con-admin', 'สมหญิง', 'รักเรียน', 'sy@example.com', ${t}, ${t}, ${t})`);
  assert.equal((await call('POST', '/api/consultation', { token: mtoken, json: form({ organization: 'Org A' }) })).status, 200);
  const { token: m2 } = await login('con-admin-nomember');
  const b = form({ organization: 'Org B' }); delete b.teamSize;
  assert.equal((await call('POST', '/api/consultation', { token: m2, json: b })).status, 200);

  const r = await call('GET', '/api/admin/consultations', { token: await adminLogin() });
  assert.equal(r.status, 200);
  const list = r.data.consultations;
  const iA = list.findIndex((x) => x.organization === 'Org A');
  const iB = list.findIndex((x) => x.organization === 'Org B');
  assert.ok(iA >= 0 && iB >= 0);
  assert.ok(iB < iA, 'newest first');
  assert.deepEqual(Object.keys(list[iA]).sort(), ['createdAt', 'email', 'goals', 'id', 'memberName', 'organization', 'systems', 'teamSize']);
  assert.equal(list[iA].memberName, 'สมหญิง รักเรียน');
  assert.equal(list[iB].memberName, '');
  assert.equal(list[iA].teamSize, 12);
  assert.equal(list[iB].teamSize, null);
  assert.equal(list[iA].systems, 'Excel และ LINE OA\nERP บัญชี');
  assert.equal(typeof list[iA].createdAt, 'number');
  assert.ok(list.length <= 200);
});

test('consultations are not exposed through the learner API', async () => {
  const { token } = await login('con-ok');
  const me = await call('GET', '/api/me', { token });
  assert.ok(!JSON.stringify(me.data).includes('Excel'));
  assert.equal((await call('GET', '/api/consultations', { token })).status, 404);
  assert.equal((await call('GET', '/api/consultation', { token })).status, 404);
});
