import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  signToken, verifyToken, isFourDigits, randomCode,
  validateRegistration, timingSafeEqualStr, slugify,
} from '../src/lib.js';

const SECRET = 'unit-test-secret';

test('signToken/verifyToken round-trip', async () => {
  const t = await signToken(SECRET, 'sess', { uid: 'u1' }, 60);
  const d = await verifyToken(SECRET, 'sess', t);
  assert.equal(d.uid, 'u1');
  assert.equal(d.typ, 'sess');
});

test('verifyToken rejects wrong typ', async () => {
  const t = await signToken(SECRET, 'sess', { uid: 'u1' }, 60);
  assert.equal(await verifyToken(SECRET, 'other', t), null);
});

test('verifyToken rejects wrong secret', async () => {
  const t = await signToken(SECRET, 'sess', { uid: 'u1' }, 60);
  assert.equal(await verifyToken('different', 'sess', t), null);
});

test('verifyToken rejects tampered body', async () => {
  const t = await signToken(SECRET, 'sess', { uid: 'u1' }, 60);
  const [body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ uid: 'admin', typ: 'sess', exp: 9999999999 })).toString('base64url');
  assert.equal(await verifyToken(SECRET, 'sess', `${forged}.${sig}`), null);
  assert.equal(await verifyToken(SECRET, 'sess', `${body}x.${sig}`), null);
});

test('verifyToken rejects expired token', async () => {
  const t = await signToken(SECRET, 'sess', { uid: 'u1' }, 60);
  assert.equal(await verifyToken(SECRET, 'sess', t, Date.now() + 120_000), null);
});

test('verifyToken rejects malformed input', async () => {
  assert.equal(await verifyToken(SECRET, 'sess', undefined), null);
  assert.equal(await verifyToken(SECRET, 'sess', 'nodot'), null);
  assert.equal(await verifyToken(SECRET, 'sess', '.'), null);
});

test('isFourDigits', () => {
  assert.equal(isFourDigits('0042'), true);
  for (const v of ['42', '12345', 'abcd', 4242, null, undefined]) assert.equal(isFourDigits(v), false);
});

test('randomCode always 4 digits', () => {
  for (let i = 0; i < 500; i++) assert.match(randomCode(new Set()), /^\d{4}$/);
});

test('randomCode finds the single free code among 9,999 taken', () => {
  const taken = new Set();
  for (let i = 0; i < 10000; i++) if (i !== 7) taken.add(String(i).padStart(4, '0'));
  assert.equal(taken.size, 9999);
  assert.equal(randomCode(taken), '0007');
});

const good = { firstName: ' Ann ', lastName: 'Lee', email: '  Ann@Example.COM ', acceptTerms: true };

test('validateRegistration accepts valid input, trims and lower-cases email', () => {
  const r = validateRegistration(good);
  assert.equal(r.ok, true);
  assert.equal(r.value.email, 'ann@example.com');
  assert.equal(r.value.firstName, 'Ann');
  assert.equal(r.value.marketing, false);
});

test('validateRegistration rejects empty names, bad email, missing acceptTerms', () => {
  assert.ok(validateRegistration({ ...good, firstName: '  ' }).errors.firstName);
  assert.ok(validateRegistration({ ...good, lastName: '' }).errors.lastName);
  assert.ok(validateRegistration({ ...good, email: 'nope' }).errors.email);
  assert.ok(validateRegistration({ ...good, email: 'a@b' }).errors.email);
  const r = validateRegistration({ ...good, acceptTerms: undefined });
  assert.equal(r.ok, false);
  assert.ok(r.errors.acceptTerms);
  assert.equal(validateRegistration({ ...good, acceptTerms: 'true' }).ok, false);
  assert.equal(validateRegistration(null).ok, false);
});

test('validateRegistration marketing true only when === true', () => {
  assert.equal(validateRegistration({ ...good, marketing: true }).value.marketing, true);
  assert.equal(validateRegistration({ ...good, marketing: 'true' }).value.marketing, false);
  assert.equal(validateRegistration({ ...good, marketing: 1 }).value.marketing, false);
});

test('timingSafeEqualStr', () => {
  assert.equal(timingSafeEqualStr('a', 'a'), true);
  assert.equal(timingSafeEqualStr('a', 'ab'), false);
  assert.equal(timingSafeEqualStr('a', 'b'), false);
});

test('slugify yields non-empty [a-z0-9-] only', () => {
  for (const s of ['Claude Code 2 วัน', 'วันนี้', '', 'Hello, World!']) {
    assert.match(slugify(s), /^[a-z0-9-]+$/);
  }
  assert.match(slugify('Claude Code 2 วัน'), /^claude-code-2-/);
});

test('verifyToken returns null (not throw) for a non-base64url signature', async () => {
  assert.equal(await verifyToken(SECRET, 'sess', 'abc.%%%'), null);
  assert.equal(await verifyToken(SECRET, 'sess', 'a.b.c'), null);
  assert.equal(await verifyToken(SECRET, 'sess', '.'), null);
});

import { csvCell } from '../src/lib.js';
import { test as csvTest } from 'node:test';
import csvAssert from 'node:assert/strict';

csvTest('csvCell neutralises formula prefixes and quotes specials', () => {
  for (const v of ['=1+1', '+a@b.co', '-1', '@x', '\tx', '\rx']) {
    csvAssert.ok(csvCell(v).replace(/^"/, '').startsWith("'"), JSON.stringify(v));
  }
  csvAssert.equal(csvCell('a,"b"'), '"a,""b"""');
  csvAssert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  csvAssert.equal(csvCell('plain'), 'plain');
  csvAssert.equal(csvCell(''), '');
});
