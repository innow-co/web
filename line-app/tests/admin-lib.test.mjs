import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clockOffset, serverTime, remainingMs, formatCountdown, formatCode, formatSize, isHttps,
  actionLabel, csvFilename, prettyDetail, kindLabel, MAX_UPLOAD_BYTES, exceedsUpload, tooBigMessage, canPreviewType, baseType, mailtoHref, forwardBadge, teamSizeLabel, consultationRow, sourceLabel, emailStatusLabel,
} from '../public/lib-admin.js';

test('server clock offset beats a wrong browser clock', () => {
  const browser = 1_000_000;                 // browser thinks it is t=1,000,000
  const offset = clockOffset(1_600_000, browser); // server says 1,600,000
  assert.equal(offset, 600_000);
  assert.equal(serverTime(offset, browser + 5000), 1_605_000);
  // code expires 5 min after the server time
  assert.equal(remainingMs(1_600_000 + 300_000, offset, browser), 300_000);
  assert.equal(remainingMs(1_600_000 + 300_000, offset, browser + 299_999), 1);
  assert.equal(remainingMs(1_600_000 + 300_000, offset, browser + 400_000), 0);
});

test('formatCountdown', () => {
  assert.equal(formatCountdown(0), '00:00');
  assert.equal(formatCountdown(-5), '00:00');
  assert.equal(formatCountdown(1), '00:01');
  assert.equal(formatCountdown(65_000), '01:05');
  assert.equal(formatCountdown(300_000), '05:00');
  assert.equal(formatCountdown((3 * 3600 + 2 * 60 + 1) * 1000), '3:02:01');
  assert.equal(formatCountdown(NaN), '00:00');
});

test('formatCode keeps leading zeros', () => {
  assert.equal(formatCode('0042'), '0042');
  assert.equal(formatCode(42), '0042');
  assert.equal(formatCode('7'), '0007');
  assert.equal(formatCode(null), '0000');
});

test('formatSize', () => {
  assert.equal(formatSize(0), '0 B');
  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(2048), '2.0 KB');
  assert.equal(formatSize(300 * 1024), '300 KB');
  assert.equal(formatSize(5 * 1024 * 1024), '5.0 MB');
});

test('isHttps accepts only https URLs without spaces', () => {
  assert.ok(isHttps('https://example.com/a?b=1'));
  assert.ok(isHttps('HTTPS://example.com'));
  assert.ok(!isHttps('http://example.com'));
  assert.ok(!isHttps('javascript:alert(1)'));
  assert.ok(!isHttps('https://exa mple.com'));
  assert.ok(!isHttps('https://'));
  assert.ok(!isHttps(''));
  assert.ok(!isHttps(null));
});

test('actionLabel is Thai for known actions and falls back to the raw name', () => {
  assert.equal(actionLabel('code_new'), 'สร้างรหัสใหม่');
  assert.equal(actionLabel('enroll_remove'), 'ลบสิทธิ์ผู้เรียน');
  assert.equal(actionLabel('something_new'), 'something_new');
  assert.equal(actionLabel(undefined), '');
});

test('csvFilename uses the local date and a safe workshop part', () => {
  const d = new Date(2026, 10, 3);
  assert.equal(csvFilename(d), 'members-2026-11-03.csv');
  assert.equal(csvFilename(d, 'ai-101'), 'members-ai-101-2026-11-03.csv');
  assert.equal(csvFilename(d, '../x y"'), 'members-xy-2026-11-03.csv');
});

test('prettyDetail and kindLabel', () => {
  assert.equal(prettyDetail('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(prettyDetail('not json'), 'not json');
  assert.equal(kindLabel('prompt'), 'Prompt Library');
});

test('client and Worker upload limits are the same number', () => {
  const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../public/lib-admin.js', import.meta.url), 'utf8');
  const num = (src, name) => {
    const m = src.match(new RegExp('const ' + name + '\\s*=\\s*([\\d\\s*]+);'));
    assert.ok(m, name + ' not found');
    return m[1].split('*').map((x) => Number(x.trim())).reduce((a, b) => a * b, 1);
  };
  assert.equal(num(client, 'MAX_UPLOAD_BYTES'), num(worker, 'MAX_UPLOAD'));
  assert.equal(num(client, 'MAX_UPLOAD_BYTES'), MAX_UPLOAD_BYTES);
});

test('exceedsUpload: exactly the limit is allowed, one byte more is not', () => {
  assert.ok(!exceedsUpload(0));
  assert.ok(!exceedsUpload(MAX_UPLOAD_BYTES));
  assert.ok(exceedsUpload(MAX_UPLOAD_BYTES + 1));
  assert.ok(exceedsUpload(43_000_000));
  assert.ok(!exceedsUpload(undefined));
});

test('tooBigMessage names the limit from the constant and points to a link', () => {
  const m = tooBigMessage(43_000_000);
  assert.ok(m.includes('41.0 MB') && m.includes('40MB') && m.includes('https'));
});

test('canPreviewType matches whole types only', () => {
  assert.ok(canPreviewType('application/pdf'));
  assert.ok(canPreviewType('Application/PDF; charset=binary'));
  assert.ok(canPreviewType('image/png'));
  assert.ok(!canPreviewType('application/pdfX'));
  assert.ok(!canPreviewType('image/svg+xml'));
  assert.ok(!canPreviewType('video/mp4x'));
  assert.ok(!canPreviewType(''));
  assert.equal(baseType(' Image/PNG ; a=b'), 'image/png');
});

test('mailtoHref only for well-formed addresses', () => {
  assert.equal(mailtoHref('hr@example.com'), 'mailto:hr@example.com');
  for (const e of ['', 'abc', 'a@b', 'a b@c.com', 'a@b.co\nbcc:evil@x.com', null, undefined]) assert.equal(mailtoHref(e), null, String(e));
  assert.equal(mailtoHref('a'.repeat(250) + '@b.co'), null);
});

test('mailtoHref refuses addresses that could add mailto headers or odd encodings', () => {
  for (const e of ['a@b.co?cc=x@y.com', 'a@b.co?subject=hi', 'a&b@c.com', 'a#b@c.com', 'a%0Ab@c.com', 'a@b.co&bcc=x@y.com']) assert.equal(mailtoHref(e), null, e);
  // Allowed characters that are not URI-safe are encoded in the href, '@' stays readable.
  assert.equal(mailtoHref("o'brien+x@example.com"), 'mailto:' + encodeURIComponent("o'brien+x").replace(/%40/g, '@') + '@example.com');
  assert.equal(mailtoHref('hr@example.com'), 'mailto:hr@example.com');
});

test('forwardBadge text', () => {
  assert.deepEqual(forwardBadge({ forwarded: true, forwardError: '' }), { text: 'ส่งอีเมลแล้ว', ok: true });
  assert.deepEqual(forwardBadge({ forwarded: false, forwardError: '500' }), { text: 'ส่งอีเมลไม่สำเร็จ: 500', ok: false });
  assert.deepEqual(forwardBadge({ forwarded: false, forwardError: '' }), { text: 'ส่งอีเมลไม่สำเร็จ', ok: false });
});

test('sourceLabel: web rows are the website, everything else is LINE', () => {
  assert.deepEqual(sourceLabel({ source: 'web' }), { text: 'เว็บไซต์', cls: 'web' });
  assert.deepEqual(sourceLabel({ source: 'line' }), { text: 'LINE', cls: 'line' });
  assert.deepEqual(sourceLabel({}), { text: 'LINE', cls: 'line' });
  assert.deepEqual(sourceLabel(null), { text: 'LINE', cls: 'line' });
});

test('emailStatusLabel: web rows say the email was sent or failed, LINE rows keep the forward wording', () => {
  assert.deepEqual(emailStatusLabel({ source: 'web', forwarded: true, forwardError: '' }), { text: 'ส่งอีเมลแล้ว', ok: true });
  assert.deepEqual(emailStatusLabel({ source: 'web', forwarded: false, forwardError: 'email-failed' }), { text: 'ส่งอีเมลไม่สำเร็จ', ok: false });
  assert.deepEqual(emailStatusLabel({ source: 'line', forwarded: false, forwardError: '500' }), { text: 'ส่งอีเมลไม่สำเร็จ: 500', ok: false });
  assert.deepEqual(emailStatusLabel({ forwarded: true }), { text: 'ส่งอีเมลแล้ว', ok: true });
});

test('isNever: flag or null/absent expiry means never expires; ordinary values do not', async () => {
  const { isNever } = await import('../public/lib-admin.js');
  assert.equal(isNever({ neverExpires: true, expiresAt: null }), true);
  assert.equal(isNever({ expiresAt: null }), true);
  assert.equal(isNever({ neverExpires: true, expiresAt: 5 }), true);
  assert.equal(isNever({ expiresAt: 1_600_000 }), false);
  assert.equal(isNever({ neverExpires: false, expiresAt: 1_600_000 }), false);
  assert.equal(isNever(null), false);
});

test('remainingMs / formatCountdown stay finite and unchanged for ordinary values, and never throw on never codes', () => {
  assert.equal(remainingMs(1_600_000 + 300_000, 600_000, 1_000_000), 300_000);
  assert.equal(remainingMs(null, 0, 1000), 0);        // null is not a time: no phantom 1970 maths, no NaN
  assert.equal(formatCountdown(Infinity), '00:00');
  assert.equal(formatCountdown(null), '00:00');
  assert.equal(formatCountdown(65000), '01:05');
});

test('formatCountdown shows days once the remainder is a day or more', () => {
  const D = 86400000;
  assert.equal(formatCountdown(D - 1000), '23:59:59');
  assert.equal(formatCountdown(D), '1 วัน 00:00:00');
  assert.equal(formatCountdown(D + 61000), '1 วัน 00:01:01');
  assert.equal(formatCountdown(30 * D), '30 วัน 00:00:00');
  assert.equal(formatCountdown(30 * D - 1000), '29 วัน 23:59:59');
  assert.equal(formatCountdown(90 * D), '90 วัน 00:00:00');
  assert.equal(formatCountdown(0), '00:00');
  assert.equal(formatCountdown(-5000), '00:00');
  assert.equal(formatCountdown(3 * 3600000 + 2 * 60000 + 1000), '3:02:01');
});

test('lifetimeWarning: none for short codes, long wording from 1 month, strong wording for never', async () => {
  const { lifetimeWarning } = await import('../public/lib-admin.js');
  assert.equal(lifetimeWarning('5'), '');
  assert.equal(lifetimeWarning('1440'), '');
  assert.equal(lifetimeWarning('43199'), '');
  assert.match(lifetimeWarning('43200'), /^รหัสนี้ใช้ได้นาน/);
  assert.match(lifetimeWarning('129600'), /^รหัสนี้ใช้ได้นาน/);
  assert.equal(lifetimeWarning('never'), 'ใครได้รับรหัสสามารถรับสิทธิ์ได้ตลอด ควรยกเลิกเมื่อไม่ใช้แล้ว');
});

test('UI default lifetime is 3 months and is one of the select options; never is last', async () => {
  const { DEFAULT_LIFETIME_MINUTES, LIFETIME_OPTIONS } = await import('../public/lib-admin.js');
  assert.equal(DEFAULT_LIFETIME_MINUTES, 129600);
  assert.ok(LIFETIME_OPTIONS.some(([v]) => v === DEFAULT_LIFETIME_MINUTES));
  assert.deepEqual(LIFETIME_OPTIONS.at(-1), ['never', 'ไม่หมดอายุ']);
  assert.ok(LIFETIME_OPTIONS.some(([v]) => v === 43200));
  assert.ok(LIFETIME_OPTIONS.some(([v]) => v === 5));
  // the default shows the long warning from the start
  assert.notEqual((await import('../public/lib-admin.js')).lifetimeWarning(DEFAULT_LIFETIME_MINUTES), '');
});

// ---- AI consultation list ----
test('teamSizeLabel: the number, or a dash when skipped or not a count', () => {
  assert.equal(teamSizeLabel(20), '20');
  assert.equal(teamSizeLabel(100000), '100000');
  for (const v of [null, undefined, '', 0, -1, 2.5, NaN, 'abc', {}]) assert.equal(teamSizeLabel(v), '-', String(v));
});

test('consultationRow maps an API row to display values with safe fallbacks', () => {
  const r = consultationRow({ id: 7, createdAt: 1700000000000, organization: 'บริษัท A', email: 'hr@example.com', systems: 'Excel\nERP', goals: 'สรุปรายงาน', teamSize: 12, memberName: 'สมหญิง รักเรียน' });
  assert.deepEqual(r, { id: 7, createdAt: 1700000000000, organization: 'บริษัท A', email: 'hr@example.com', mailto: 'mailto:hr@example.com', systems: 'Excel\nERP', goals: 'สรุปรายงาน', teamSize: '12', memberName: 'สมหญิง รักเรียน' });
  const e = consultationRow({ id: 8, createdAt: 1, organization: 'x', email: 'a@b.co?cc=evil@x.com', systems: 's', goals: 'g', teamSize: null, memberName: '' });
  assert.equal(e.mailto, null, 'a header-injecting address is never a mailto link');
  assert.equal(e.teamSize, '-');
  assert.equal(e.memberName, '-');
  const bad = consultationRow(null);
  assert.deepEqual([bad.organization, bad.email, bad.mailto, bad.systems, bad.goals, bad.teamSize, bad.memberName], ['', '', null, '', '', '-', '-']);
});

test('consultation tab: markup uses h()/textContent only, no inline style, no innerHTML (CSP-safe)', () => {
  const js = readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');
  const start = js.indexOf('async function consultationsView');
  assert.ok(start > 0, 'consultationsView exists');
  const block = js.slice(start, js.indexOf('// ---------- start ----------'));
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|\.style\b|style:|setAttribute\(['"]style/.test(block), 'no innerHTML or inline style in the consultations view');
  assert.match(js, /href: '#\/consultations'/);
  assert.match(js, /ปรึกษา AI Automation/);
});
