import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clockOffset, serverTime, remainingMs, formatCountdown, formatCode, formatSize, isHttps,
  actionLabel, csvFilename, prettyDetail, kindLabel, MAX_UPLOAD_BYTES, exceedsUpload, tooBigMessage, canPreviewType, baseType,
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
