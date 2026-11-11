import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRoute, routeUrl, oaMessageUrl } from '../public/lib-app.js';
import {
  STEPS, COURSE_DEFAULT, COURSE_GROUPS, EXPECTATIONS, LIMITS, emptyAnswers, validateStep, nextStep, prevStep,
  stepNumber, summaryRows, buildPayload, firstFailingStep, parseDraft,
} from '../public/lib-wizard.js';
import { validateInquiry } from '../src/lib.js';

const good = () => ({ organization: 'บริษัท ตัวอย่าง', course: COURSE_DEFAULT, expectation: EXPECTATIONS[1], learners: '20', email: 'hr@example.com', details: '' });

// ---- routes ----
test('parseRoute and routeUrl know ?p=contact', () => {
  assert.deepEqual(parseRoute('?p=contact'), { name: 'contact' });
  assert.deepEqual(parseRoute('?liff.state=%3Fp%3Dcontact'), { name: 'contact' });
  assert.equal(routeUrl({ name: 'contact' }), '?p=contact');
  assert.equal(routeUrl({ name: 'contact' }, { dev: 'u1' }), '?p=contact&dev=u1');
});

// ---- oaMessageUrl ----
test('oaMessageUrl encodes @ as %40 and the text with encodeURIComponent', () => {
  assert.equal(oaMessageUrl('@276eafaf', 'x y'), 'https://line.me/R/oaMessage/%40276eafaf/?x%20y');
  assert.equal(oaMessageUrl('276eafaf', 'x y'), 'https://line.me/R/oaMessage/%40276eafaf/?x%20y');
  assert.equal(oaMessageUrl(' @@276eafaf ', 'x y'), 'https://line.me/R/oaMessage/%40276eafaf/?x%20y');
  assert.equal(oaMessageUrl('@276eafaf', 'สอบถามบทเรียนที่เรียนไปแล้ว'), 'https://line.me/R/oaMessage/%40276eafaf/?' + encodeURIComponent('สอบถามบทเรียนที่เรียนไปแล้ว'));
});
test('oaMessageUrl: empty basic id gives no link', () => {
  for (const v of ['', '  ', '@', null, undefined]) assert.equal(oaMessageUrl(v, 'x'), '', String(v));
});

// ---- steps and lists ----
test('steps are in the owner-specified order, only details is optional', () => {
  assert.deepEqual(STEPS.map((s) => s.id), ['organization', 'course', 'expectation', 'learners', 'email', 'details']);
  assert.deepEqual(STEPS.filter((s) => !s.required).map((s) => s.id), ['details']);
  assert.equal(STEPS.length, 6);
});

test('course and expectation lists match the website form exactly', () => {
  assert.equal(COURSE_DEFAULT, 'ยังไม่แน่ใจ อยากให้ช่วยแนะนำ');
  assert.deepEqual(COURSE_GROUPS, [
    { label: 'สายธุรกิจและผู้บริหาร', items: ['ChatGPT & AI Mastery', "ChatGPT Astra at Work: Standardize Your Team's Workflow", 'Claude Cowork: Connect, Automate, and Collaborate with AI', 'AI Decision System for Leaders'] },
    { label: 'สายนักพัฒนา', items: ['AI-Powered Software Development Mastery', 'Claude Code for Software Dev Process', 'Secure Coding'] },
  ]);
  assert.deepEqual(EXPECTATIONS, [
    'บรรยาย ครึ่งวัน–1 วัน มี Workshop เล็กน้อย',
    'Workshop ระยะสั้น 2 วัน เน้นลงมือทำจริงและขอหัวข้อที่ต้องการได้',
    'Bootcamp มุ่งสร้างผลงานที่จับต้องได้หลังเรียนจบ',
    'หลักสูตรขั้นสูงสำหรับผู้บริหาร เช่น Governance / Policy Control 1 วัน',
    'อื่นๆ',
  ]);
});

test('the course and expectation lists equal the website select options (index.html is the source)', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const sel = (id) => html.match(new RegExp(`<select[^>]*id="${id}"[\\s\\S]*?</select>`))[0];
  const opts = (block) => [...block.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1].replace(/&amp;/g, '&').trim());
  assert.deepEqual(opts(sel('course')), [COURSE_DEFAULT, ...COURSE_GROUPS.flatMap((g) => g.items)]);
  assert.deepEqual(opts(sel('expectation')).slice(1), EXPECTATIONS);
});

test('emptyAnswers: course preselected, email prefilled when present', () => {
  assert.deepEqual(emptyAnswers(), { organization: '', course: COURSE_DEFAULT, expectation: '', learners: '', email: '', details: '' });
  assert.equal(emptyAnswers('a@b.co').email, 'a@b.co');
  assert.equal(emptyAnswers(null).email, '');
  assert.equal(emptyAnswers(42).email, '');
});

test('nextStep / prevStep walk the order and end at the summary', () => {
  assert.equal(nextStep('organization'), 'course');
  assert.equal(nextStep('email'), 'details');
  assert.equal(nextStep('details'), 'summary');
  assert.equal(nextStep('summary'), null);
  assert.equal(prevStep('summary'), 'details');
  assert.equal(prevStep('course'), 'organization');
  assert.equal(prevStep('organization'), null);
  assert.equal(nextStep('nope'), null);
  assert.equal(prevStep('nope'), null);
  assert.equal(stepNumber('organization'), 1);
  assert.equal(stepNumber('details'), 6);
  assert.equal(stepNumber('summary'), 6);
});

test('going back never touches answers (pure functions, input not mutated)', () => {
  const a = good();
  const before = JSON.stringify(a);
  prevStep('learners'); nextStep('learners'); validateStep('learners', a); summaryRows(a);
  assert.equal(JSON.stringify(a), before);
});

// ---- per-step validation ----
test('organization: required, trimmed, <= 160, no line breaks', () => {
  const v = (organization) => validateStep('organization', { ...good(), organization });
  assert.deepEqual(v('x'), { ok: true, error: '' });
  assert.equal(v('').error, 'กรอกชื่อองค์กร');
  assert.equal(v('   ').error, 'กรอกชื่อองค์กร');
  assert.equal(v('x'.repeat(160)).ok, true);
  assert.equal(v('x'.repeat(161)).error, 'กรอกชื่อองค์กร');
  assert.equal(v('a\nb').ok, false);
  assert.equal(v(' ' + 'x'.repeat(160) + ' ').ok, true);
});

test('course and expectation: required', () => {
  assert.equal(validateStep('course', { ...good(), course: '' }).error, 'เลือกหลักสูตรที่สนใจ');
  assert.equal(validateStep('course', good()).ok, true);
  assert.equal(validateStep('expectation', { ...good(), expectation: '' }).error, 'เลือกรูปแบบที่ต้องการ');
  assert.equal(validateStep('expectation', good()).ok, true);
});

test('learners: whole number 1..100000 only', () => {
  const msg = 'กรอกจำนวนผู้เรียนเป็นจำนวนเต็มตั้งแต่ 1 ถึง 100,000 คน';
  const v = (learners) => validateStep('learners', { ...good(), learners });
  for (const ok of ['1', '20', '100000', ' 20 ', '007']) assert.equal(v(ok).ok, true, ok);
  for (const bad of ['', ' ', '0', '100001', '20.5', '1e3', '-3', 'abc', '0x10', '2 0', '99999999999999999999']) assert.deepEqual(v(bad), { ok: false, error: msg }, bad);
});

test('email: required, shape, <= 254', () => {
  const v = (email) => validateStep('email', { ...good(), email });
  assert.equal(v('hr@example.com').ok, true);
  assert.equal(v(' hr@example.com ').ok, true);
  for (const bad of ['', 'abc', 'a@b', 'a b@c.com', '@b.com']) assert.equal(v(bad).error, 'กรอกอีเมลติดต่อให้ถูกต้อง', bad);
  const local = (n) => 'a'.repeat(n - '@b.co'.length) + '@b.co';
  assert.equal(v(local(254)).ok, true);
  assert.equal(v(local(255)).ok, false);
});

test('details: optional, <= 2000, line breaks allowed', () => {
  const v = (details) => validateStep('details', { ...good(), details });
  assert.equal(v('').ok, true);
  assert.equal(v('a\nb').ok, true);
  assert.equal(v('x'.repeat(2000)).ok, true);
  assert.equal(v('x'.repeat(2001)).error, 'รายละเอียดเพิ่มเติมต้องไม่เกิน 2,000 ตัวอักษร');
});

test('validateStep: unknown step id is rejected', () => {
  assert.equal(validateStep('nope', good()).ok, false);
});

// ---- parity with the server ----
test('PARITY: every step gives the same verdict and message as validateInquiry on boundary inputs', () => {
  const long = (n) => 'x'.repeat(n);
  const mail = (n) => 'a'.repeat(n - '@b.co'.length) + '@b.co';
  const cases = {
    organization: ['', ' ', 'x', long(160), long(161), 'a\nb', 'a\rb', ' ' + long(160) + ' ', 'บริษัท'],
    course: ['', ' ', 'x', long(200), long(201), 'a\nb', COURSE_DEFAULT],
    expectation: ['', ' ', 'x', long(300), long(301), 'a\nb', 'a\r\nb', EXPECTATIONS[0]],
    learners: ['', ' ', '0', '1', '2', '99999', '100000', '100001', '20.5', '1e3', '-1', 'abc', '0x10', '2 0', ' 20 ', '9007199254740993', '99999999999999999999', '007'],
    email: ['', 'abc', 'a@b', 'a b@c.com', '@b.com', 'a@@b.com', 'hr@example.com', ' hr@example.com ', mail(254), mail(255), 'a@b.c', 'a@b .com'],
    details: ['', long(2000), long(2001), 'a\nb\r\nc', ' ' + long(2000) + ' '],
  };
  let n = 0;
  for (const [field, values] of Object.entries(cases)) {
    for (const value of values) {
      const answers = { ...good(), [field]: value };
      const server = validateInquiry({ ...answers, learners: answers.learners });
      const client = validateStep(field, answers);
      assert.equal(client.ok, !server.errors[field], `${field}=${JSON.stringify(value).slice(0, 40)} client ${client.ok} server ${!server.errors[field]}`);
      if (!client.ok) assert.equal(client.error, server.errors[field], `${field} message`);
      n++;
    }
  }
  assert.ok(n > 40);
});

test('PARITY: published limits equal the numbers in src/lib.js', () => {
  const src = readFileSync(new URL('../src/lib.js', import.meta.url), 'utf8');
  const has = (re) => assert.match(src, re);
  assert.deepEqual(LIMITS, { organization: 160, email: 254, course: 200, expectation: 300, details: 2000, learnersMin: 1, learnersMax: 100000 });
  has(/organization\.length > 160/); has(/email\.length > 254/); has(/course\.length > 200/);
  has(/expectation\.length > 300/); has(/details\.length > 2000/); has(/learners < 1 \|\| learners > 100000/);
});

test('a fully valid wizard passes the server validator and buildPayload is what the server expects', () => {
  const a = good();
  for (const s of STEPS) assert.equal(validateStep(s.id, a).ok, true, s.id);
  const body = buildPayload({ ...a, organization: '  บริษัท  ', learners: ' 20 ', details: ' hi ' });
  assert.deepEqual(body, { organization: 'บริษัท', email: 'hr@example.com', course: COURSE_DEFAULT, expectation: EXPECTATIONS[1], details: 'hi', learners: '20' });
  assert.equal(validateInquiry(body).ok, true);
  assert.equal(validateInquiry(body).value.learners, 20);
});

// ---- summary, 422 mapping, draft ----
test('summaryRows: one row per answer in step order with an edit target, empty details shown as not given', () => {
  const rows = summaryRows({ ...good(), learners: '20' });
  assert.deepEqual(rows.map((r) => r.step), ['organization', 'course', 'expectation', 'learners', 'email', 'details']);
  assert.deepEqual(rows.map((r) => r.label), ['ชื่อองค์กร', 'หลักสูตรที่สนใจ', 'รูปแบบและความคาดหวัง', 'จำนวนผู้เรียนโดยประมาณ', 'อีเมลติดต่อ', 'รายละเอียดเพิ่มเติม']);
  assert.equal(rows[0].value, 'บริษัท ตัวอย่าง');
  assert.equal(rows[3].value, '20 คน');
  assert.equal(rows[5].value, 'ไม่ได้ระบุ');
  assert.equal(summaryRows({ ...good(), details: ' hello ' })[5].value, 'hello');
});

test('firstFailingStep picks the earliest step with a server error', () => {
  assert.equal(firstFailingStep({ email: 'x', course: 'y' }), 'course');
  assert.equal(firstFailingStep({ learners: 'x' }), 'learners');
  assert.equal(firstFailingStep({ unknown: 'x' }), null);
  assert.equal(firstFailingStep(null), null);
});

test('parseDraft restores only known string fields and a valid step', () => {
  const raw = JSON.stringify({ step: 'learners', answers: { ...good(), organization: 'A', evil: 'x', learners: 5 } });
  const d = parseDraft(raw, 'prefill@x.co');
  assert.equal(d.step, 'learners');
  assert.equal(d.answers.organization, 'A');
  assert.equal(d.answers.learners, '');
  assert.ok(!('evil' in d.answers));
  assert.equal(parseDraft('{not json', ''), null);
  assert.equal(parseDraft(null, ''), null);
  assert.equal(parseDraft(JSON.stringify({ step: 'zzz', answers: {} }), '').step, 'organization');
  assert.equal(parseDraft(JSON.stringify({ step: 'summary', answers: good() }), '').step, 'summary');
  // a draft with an empty email falls back to the prefill
  assert.equal(parseDraft(JSON.stringify({ step: 'email', answers: { ...good(), email: '' } }), 'p@x.co').answers.email, 'p@x.co');
});
